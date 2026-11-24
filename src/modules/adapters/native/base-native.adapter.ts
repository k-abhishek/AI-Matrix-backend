import prisma from '../../../lib/prisma';
import credentialVaultService from '../../../lib/vault/credential-vault.service';
import env from '../../../config/env';
import {
  BaseConnectorAdapter,
  ConnectorConnectionContext,
  ConnectionHealthResult,
  DiscoveredTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../base.adapter';
import logger from '../../../lib/logger';
import oauthProviderRegistry from '../../connections/oauth/oauth-provider.registry';

export abstract class BaseNativeAdapter implements BaseConnectorAdapter {
  abstract readonly connectorType: 'NATIVE';
  abstract readonly connectorKey: string;

  abstract testConnection(context: ConnectorConnectionContext): Promise<ConnectionHealthResult>;
  abstract discoverTools(context: ConnectorConnectionContext): Promise<DiscoveredTool[]>;
  abstract executeTool(
    toolName: string,
    params: Record<string, any>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult>;

  /**
   * Refreshes an expired OAuth access token via oauthProviderRegistry and updates vault storage.
   */
  private async refreshOAuthToken(
    connectionId: string,
    refreshToken: string,
    currentCreds: Record<string, any>
  ): Promise<Record<string, any> | null> {
    const handler = oauthProviderRegistry.getHandler(this.connectorKey);
    if (!handler?.refreshToken) {
      return null;
    }

    try {
      const tokenResult = await handler.refreshToken(refreshToken);
      const expiresIn = tokenResult.expiresIn || 3600;
      const newExpiresAt = new Date(Date.now() + expiresIn * 1000);

      const updatedCreds = {
        ...currentCreds,
        accessToken: tokenResult.accessToken,
        token: tokenResult.accessToken,
        refreshToken: tokenResult.refreshToken || refreshToken,
        expiresAt: newExpiresAt,
      };

      const encrypted = credentialVaultService.encrypt(updatedCreds);

      await prisma.connectorCredential.update({
        where: { connectionId },
        data: {
          encryptedData: encrypted.encryptedData,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyId: encrypted.keyId,
          expiresAt: newExpiresAt,
        },
      });

      logger.info(
        `[BaseNativeAdapter] Successfully refreshed expired access token for connection '${connectionId}' (${this.connectorKey})`
      );
      return updatedCreds;
    } catch (err: any) {
      logger.warn(
        `[BaseNativeAdapter] Exception refreshing token for '${connectionId}' (${this.connectorKey}): ${err.message}`
      );
      return null;
    }
  }

  /**
   * Helper to resolve and decrypt credentials for a given connection or context.
   * Automatically refreshes expired OAuth access tokens when a valid refresh token exists.
   */
  protected async resolveCredentials(
    context: ConnectorConnectionContext | ToolExecutionContext
  ): Promise<Record<string, any>> {
    if (context.credentials && Object.keys(context.credentials).length > 0) {
      return context.credentials;
    }

    const connectionId = 'connectionId' in context ? context.connectionId : context.id;
    if (!connectionId) return {};

    try {
      const dbCred = await prisma.connectorCredential.findUnique({
        where: { connectionId },
      });

      if (!dbCred) return {};

      const decrypted = credentialVaultService.decrypt({
        encryptedData: dbCred.encryptedData,
        iv: dbCred.iv,
        authTag: dbCred.authTag,
        keyId: dbCred.keyId,
      });

      const refreshToken = decrypted.refreshToken;
      const isExpired = dbCred.expiresAt && dbCred.expiresAt.getTime() <= Date.now() + 60000;

      if (isExpired && refreshToken) {
        const refreshed = await this.refreshOAuthToken(connectionId, refreshToken, decrypted);
        if (refreshed) {
          return refreshed;
        }
      }

      return decrypted;
    } catch (err: any) {
      logger.warn(`[BaseNativeAdapter] Credential decryption failed for '${connectionId}': ${err.message}`);
      return {};
    }
  }
}
