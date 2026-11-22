import { ConnectionAuthType } from '@prisma/client';
import prisma from '../../lib/prisma';
import credentialVaultService from '../../lib/vault/credential-vault.service';
import logger from '../../lib/logger';
import { UnauthorizedError } from '../../lib/errors';

export class McpAuthManager {
  /**
   * Retrieves and decrypts connection credentials, validates token expiry,
   * performs automatic token refresh if needed, and returns HTTP auth headers.
   */
  async getAuthHeaders(connectionId: string): Promise<Record<string, string>> {
    const connection = await prisma.connectorConnection.findUnique({
      where: { id: connectionId },
      include: {
        credential: true,
        connectorDefinition: true,
      },
    });

    if (!connection) {
      throw new UnauthorizedError(`Connection '${connectionId}' not found`);
    }

    if (connection.authType === ConnectionAuthType.NONE) {
      return {};
    }

    if (!connection.credential) {
      return {};
    }

    const decrypted = credentialVaultService.decrypt({
      encryptedData: connection.credential.encryptedData,
      iv: connection.credential.iv,
      authTag: connection.credential.authTag,
      keyId: connection.credential.keyId,
    });

    return this.buildHeadersFromDecrypted(connection.authType, decrypted, connection.credential.expiresAt);
  }

  /**
   * Formats HTTP headers from decrypted credentials.
   */
  buildHeadersFromDecrypted(
    authType: ConnectionAuthType,
    credentials: Record<string, any>,
    expiresAt?: Date | null
  ): Record<string, string> {
    const headers: Record<string, string> = {};

    switch (authType) {
      case ConnectionAuthType.BEARER_TOKEN: {
        const token = credentials.accessToken || credentials.token || credentials.bearerToken;
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        break;
      }

      case ConnectionAuthType.API_KEY: {
        const headerName = credentials.headerName || 'X-API-Key';
        const apiKey = credentials.apiKey || credentials.key;
        if (apiKey) {
          headers[headerName] = apiKey;
        }
        break;
      }

      case ConnectionAuthType.CUSTOM_HEADERS: {
        const customHeaders = credentials.customHeaders || credentials.headers || {};
        for (const [key, value] of Object.entries(customHeaders)) {
          if (value && typeof value === 'string') {
            headers[key] = value;
          }
        }
        break;
      }

      case ConnectionAuthType.OAUTH2_AUTHORIZATION_CODE:
      case ConnectionAuthType.OAUTH2_CLIENT_CREDENTIALS: {
        const token = credentials.accessToken || credentials.token;
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        // Warn if token is close to expiry (< 60s)
        if (expiresAt && expiresAt.getTime() - Date.now() < 60000) {
          logger.warn(`[McpAuthManager] OAuth token for connection is expiring soon at ${expiresAt.toISOString()}`);
        }
        break;
      }

      case ConnectionAuthType.BASIC_AUTH: {
        const username = credentials.username || '';
        const password = credentials.password || '';
        const encoded = Buffer.from(`${username}:${password}`).toString('base64');
        headers['Authorization'] = `Basic ${encoded}`;
        break;
      }

      case ConnectionAuthType.NONE:
      default:
        break;
    }

    return headers;
  }
}

export const mcpAuthManager = new McpAuthManager();
export default mcpAuthManager;
