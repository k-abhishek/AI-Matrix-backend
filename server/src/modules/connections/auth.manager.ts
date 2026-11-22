import crypto from 'crypto';
import prisma from '../../lib/prisma';
import env from '../../config/env';
import credentialVaultService from '../../lib/vault/credential-vault.service';
import mcpDiscoveryService from '../mcp/mcp-discovery.service';
import { NotFoundError, BadRequestError } from '../../lib/errors';
import logger from '../../lib/logger';

export class AuthManager {
  /**
   * Generates PKCE code challenge and cryptographically secure state, saves an
   * OAuthTransaction, and returns the provider authorization URL.
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
    const provider = connection.connectorDefinition.key;
    const scopes: string[] = (connection.connectorDefinition.defaultConfig as any)?.defaultScopes || [];

    let authorizationUrl = '';

    if (
      provider === 'gmail' ||
      provider === 'google-calendar' ||
      provider === 'google-drive' ||
      provider === 'google-docs'
    ) {
      const clientId = env.GOOGLE_CLIENT_ID || 'mock_google_client_id';
      const scopeParam = encodeURIComponent(scopes.join(' '));
      const redirectParam = encodeURIComponent(redirectUri);

      authorizationUrl =
        `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${clientId}` +
        `&redirect_uri=${redirectParam}` +
        `&response_type=code` +
        `&scope=${scopeParam}` +
        `&access_type=offline` +
        `&prompt=consent` +
        `&state=${state}` +
        `&code_challenge=${codeChallenge}` +
        `&code_challenge_method=S256`;
    } else if (provider === 'slack') {
      const clientId = env.SLACK_CLIENT_ID || (process.env.NODE_ENV === 'test' ? 'mock_slack_client_id' : '');
      if (!clientId) {
        throw new BadRequestError(
          'Slack OAuth is not configured. Please set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in .env, or connect using a Slack Bot Token (Bearer Token).'
        );
      }
      const scopeParam = encodeURIComponent(scopes.join(','));
      const redirectParam = encodeURIComponent(redirectUri);

      authorizationUrl =
        `https://slack.com/oauth/v2/authorize?` +
        `client_id=${clientId}` +
        `&redirect_uri=${redirectParam}` +
        `&scope=${scopeParam}` +
        `&state=${state}`;
    } else {
      throw new BadRequestError(
        `OAuth 2.0 is not configured for '${connection.connectorDefinition.name || provider}'. Please connect using direct credentials (API Token / Key / Basic Auth).`
      );
    }

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
    const provider = connection.connectorDefinition.key;

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

      // Delete transaction to prevent replay
      await tx.oAuthTransaction.delete({
        where: { id: transaction.id },
      });
    });

    // Asynchronously trigger MCP discovery so tools are populated immediately
    mcpDiscoveryService.discoverAll(connection.id).catch((err) => {
      logger.warn(`[AuthManager] Initial post-auth discovery failed for connection '${connection.id}': ${err.message}`);
    });

    const redirectUrl = `${env.FRONTEND_REDIRECT_BASE_URL}?connectionId=${connection.id}&status=success`;
    return {
      connectionId: connection.id,
      status: 'CONNECTED',
      redirectUrl,
    };
  }

  /**
   * Exchanges code with upstream OAuth provider token endpoint.
   */
  private async exchangeCodeForTokens(
    provider: string,
    code: string,
    codeVerifier: string | null,
    redirectUri: string
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    tokenType?: string;
    expiresIn?: number;
    scopes?: string[];
  }> {
    if (
      provider === 'gmail' ||
      provider === 'google-calendar' ||
      provider === 'google-drive' ||
      provider === 'google-docs'
    ) {
      if (process.env.NODE_ENV === 'test' && !env.GOOGLE_CLIENT_SECRET) {
        return {
          accessToken: `mock_google_access_${code}`,
          refreshToken: `mock_google_refresh_${code}`,
          expiresIn: 3600,
          tokenType: 'Bearer',
        };
      }

      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      });

      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new BadRequestError(`Google OAuth token exchange failed: ${errorText}`);
      }

      const json = await res.json() as any;
      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        tokenType: json.token_type,
        expiresIn: json.expires_in,
        scopes: json.scope ? json.scope.split(' ') : [],
      };
    } else if (provider === 'slack') {
      if (process.env.NODE_ENV === 'test' && !env.SLACK_CLIENT_SECRET) {
        return {
          accessToken: `mock_slack_access_${code}`,
          tokenType: 'Bearer',
        };
      }

      const params = new URLSearchParams({
        client_id: env.SLACK_CLIENT_ID,
        client_secret: env.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      });

      const res = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      const json = await res.json() as any;
      if (!json.ok) {
        throw new BadRequestError(`Slack OAuth exchange failed: ${json.error}`);
      }

      return {
        accessToken: json.authed_user?.access_token || json.access_token,
        refreshToken: json.refresh_token,
        tokenType: 'Bearer',
        scopes: json.scope ? json.scope.split(',') : [],
      };
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
