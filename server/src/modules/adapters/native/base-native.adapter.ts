import prisma from '../../../lib/prisma';
import credentialVaultService from '../../../lib/vault/credential-vault.service';
import {
  BaseConnectorAdapter,
  ConnectorConnectionContext,
  ConnectionHealthResult,
  DiscoveredTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../base.adapter';
import logger from '../../../lib/logger';

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
   * Helper to resolve and decrypt credentials for a given connection or context.
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

      return credentialVaultService.decrypt({
        encryptedData: dbCred.encryptedData,
        iv: dbCred.iv,
        authTag: dbCred.authTag,
        keyId: dbCred.keyId,
      });
    } catch (err: any) {
      logger.warn(`[BaseNativeAdapter] Credential decryption failed for '${connectionId}': ${err.message}`);
      return {};
    }
  }
}
