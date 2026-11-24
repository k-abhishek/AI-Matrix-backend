import crypto from 'crypto';
import prisma from '../../lib/prisma';
import env from '../../config/env';
import credentialVaultService from '../../lib/vault/credential-vault.service';
import { NotFoundError, BadRequestError } from '../../lib/errors';
import logger from '../../lib/logger';
import oauthProviderRegistry from './oauth/oauth-provider.registry';
import { OAuthTokenResult } from './oauth/oauth-provider.interface';

export class AuthManager {
  /**
   * Generates PKCE code challenge and cryptographically secure state, saves an
   * OAuthTransaction, and returns the provider authorization URL.
   * Requires both Client ID and Client Secret in env.
   */
  async initiateOAuth(
    connectionId: string,
    workspaceId: string,
    customRedirectBaseUrl?: string
  ): Promise<{ authorizationUrl: string; state: string }> {
    const connection = await prisma.connectorConnection.findFirst({
      where: { id: connectionId, workspaceId },
      include: { connectorDefinition: true },
    });

    if (!connection) {
      throw new NotFoundError(`Connection '${connectionId}' not found in workspace`);
    }

    const redirectUri = customRedirectBaseUrl || env.OAUTH_REDIRECT_BASE_URL;
    const state = crypto.randomBytes(32).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes TTL
    const provider = connection.connectorDefinition.key.toLowerCase();
    const scopes: string[] = (connection.connectorDefinition.defaultConfig as any)?.defaultScopes || [];

    const handler = oauthProviderRegistry.getHandler(provider);
    if (!handler) {
      const err = new BadRequestError(
        `OAuth 2.0 is not configured for '${connection.connectorDefinition.name || provider}'. Please connect using direct credentials (API Token / Key / Basic Auth).`
      );
      (err as any).code = 'OAUTH_NOT_CONFIGURED';
      throw err;
    }

    const authorizationUrl = handler.buildAuthorizationUrl({
      state,
      redirectUri,
      scopes,
      codeChallenge,
    });

    // Persist OAuthTransaction
    await prisma.oAuthTransaction.create({
      data: {
        connectionId: connection.id,
        state,
        codeVerifier,
        redirectUri,
        scopes,
        expiresAt,
      },
    });

    return { authorizationUrl, state };
  }

  /**
   * Handles OAuth provider redirect callback, exchanges authorization code for tokens,
   * stores encrypted credentials in vault, and marks connection as CONNECTED.
   */
  async handleOAuthCallback(
    code: string,
    state: string
  ): Promise<{ connectionId: string; status: string; redirectUrl: string }> {
    const transaction = await prisma.oAuthTransaction.findUnique({
      where: { state },
      include: {
        connection: {
          include: { connectorDefinition: true },
        },
      },
    });

    if (!transaction) {
      throw new BadRequestError('Invalid, expired, or previously redeemed OAuth state token');
    }

    if (transaction.expiresAt.getTime() < Date.now()) {
      await prisma.oAuthTransaction.delete({ where: { id: transaction.id } }).catch(() => {});
      throw new BadRequestError('OAuth state token has expired');
    }

    const { connection } = transaction;
    const provider = connection.connectorDefinition.key.toLowerCase();

    // Exchange authorization code with upstream provider
    const tokenResult = await this.exchangeCodeForTokens(
      provider,
      code,
      transaction.codeVerifier,
      transaction.redirectUri
    );

    // Encrypt received tokens into CredentialVault
    const encrypted = credentialVaultService.encrypt({
      accessToken: tokenResult.accessToken,
      refreshToken: tokenResult.refreshToken,
      tokenType: tokenResult.tokenType || 'Bearer',
      scopes: tokenResult.scopes || transaction.scopes,
      expiresIn: tokenResult.expiresIn,
      ...(tokenResult.extraData || {}),
    });

    const expiresAt = tokenResult.expiresIn
      ? new Date(Date.now() + tokenResult.expiresIn * 1000)
      : null;

    await prisma.$transaction(async (tx) => {
      await tx.connectorCredential.upsert({
        where: { connectionId: connection.id },
        update: {
          encryptedData: encrypted.encryptedData,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyId: encrypted.keyId,
          expiresAt,
          refreshTokenExpiresAt: tokenResult.refreshToken ? new Date(Date.now() + 180 * 24 * 60 * 60 * 1000) : undefined,
          tokenType: tokenResult.tokenType || 'Bearer',
          scopes: tokenResult.scopes || transaction.scopes,
        },
        create: {
          connectionId: connection.id,
          encryptedData: encrypted.encryptedData,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyId: encrypted.keyId,
          expiresAt,
          refreshTokenExpiresAt: tokenResult.refreshToken ? new Date(Date.now() + 180 * 24 * 60 * 60 * 1000) : null,
          tokenType: tokenResult.tokenType || 'Bearer',
          scopes: tokenResult.scopes || transaction.scopes,
        },
      });

      await tx.connectorConnection.update({
        where: { id: connection.id },
        data: {
          status: 'CONNECTED',
          lastConnectedAt: new Date(),
          lastErrorMessage: null,
        },
      });

      // Delete transaction to prevent replay (single-use state)
      await tx.oAuthTransaction.delete({
        where: { id: transaction.id },
      });
    });

    // Trigger tool discovery
    try {
      const { connectionService } = await import('./connection.service');
      connectionService.discoverConnection(connection.id, connection.workspaceId).catch((err) => {
        logger.warn(`[AuthManager] Initial post-auth discovery failed for connection '${connection.id}': ${err.message}`);
      });
    } catch (err: any) {
      logger.warn(`[AuthManager] Discovery trigger skipped: ${err.message}`);
    }

    const frontendBase = env.FRONTEND_REDIRECT_BASE_URL.endsWith('/connector')
      ? env.FRONTEND_REDIRECT_BASE_URL
      : `${env.FRONTEND_REDIRECT_BASE_URL.replace(/\/+$/, '')}/connector`;

    const redirectUrl = `${frontendBase}?tab=connections&status=success&connectionId=${encodeURIComponent(connection.id)}`;

    return {
      connectionId: connection.id,
      status: 'CONNECTED',
      redirectUrl,
    };
  }

  /**
   * Exchanges code with upstream OAuth provider token endpoint via provider strategy.
   */
  private async exchangeCodeForTokens(
    provider: string,
    code: string,
    codeVerifier: string | null,
    redirectUri: string
  ): Promise<OAuthTokenResult> {
    const handler = oauthProviderRegistry.getHandler(provider);
    if (handler) {
      return handler.exchangeCode({
        code,
        codeVerifier,
        redirectUri,
      });
    }

    // Default test fallback
    return {
      accessToken: `mock_access_token_${code}`,
      refreshToken: `mock_refresh_token_${code}`,
      expiresIn: 3600,
      tokenType: 'Bearer',
    };
  }

  /**
   * Saves direct API keys or Bearer tokens into CredentialVault.
   */
  async saveDirectCredentials(
    connectionId: string,
    workspaceId: string,
    credentials: Record<string, any>
  ): Promise<void> {
    const connection = await prisma.connectorConnection.findFirst({
      where: { id: connectionId, workspaceId },
    });

    if (!connection) {
      throw new NotFoundError(`Connection '${connectionId}' not found in workspace`);
    }

    const encrypted = credentialVaultService.encrypt(credentials);

    await prisma.$transaction(async (tx) => {
      await tx.connectorCredential.upsert({
        where: { connectionId },
        update: {
          encryptedData: encrypted.encryptedData,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyId: encrypted.keyId,
          expiresAt: credentials.expiresAt ? new Date(credentials.expiresAt) : undefined,
          tokenType: credentials.tokenType || 'Bearer',
        },
        create: {
          connectionId,
          encryptedData: encrypted.encryptedData,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyId: encrypted.keyId,
          expiresAt: credentials.expiresAt ? new Date(credentials.expiresAt) : null,
          tokenType: credentials.tokenType || 'Bearer',
        },
      });

      await tx.connectorConnection.update({
        where: { id: connectionId },
        data: {
          status: 'CONNECTED',
          lastConnectedAt: new Date(),
          lastErrorMessage: null,
        },
      });
    });
  }
}

export const authManager = new AuthManager();
export default authManager;
