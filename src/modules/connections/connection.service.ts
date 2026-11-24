import prisma from '../../lib/prisma';
import credentialVaultService from '../../lib/vault/credential-vault.service';
import ssrfGuard from '../../lib/network/ssrf-guard';
import { NotFoundError, BadRequestError } from '../../lib/errors';
import {
  CreateConnectionDTO,
  UpdateConnectionDTO,
  ConnectionResponseDTO,
  ConnectRequestDTO,
  ConnectResultDTO,
} from './connection.types';
import connectorRegistry from '../connectors/connector.registry';
import authManager from './auth.manager';
import logger from '../../lib/logger';
import { ConnectionStatus } from '@prisma/client';

export class ConnectionService {
  private isUuid(val?: string): boolean {
    if (!val) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  }

  /**
   * Resolves the connector definition ID either from definitionId or connectorKey.
   * Gracefully ignores non-UUID definition IDs and resolves by connectorKey.
   */
  private async resolveDefinitionId(input: CreateConnectionDTO): Promise<string> {
    if (input.connectorDefinitionId && this.isUuid(input.connectorDefinitionId)) {
      try {
        const dbDef = await prisma.connectorDefinition.findUnique({
          where: { id: input.connectorDefinitionId },
        });
        if (dbDef) return dbDef.id;
      } catch {
        // Fall through
      }
      return input.connectorDefinitionId;
    }

    // Ignore non-UUID connectorDefinitionId and resolve by connectorKey
    if (input.connectorKey) {
      try {
        const dbDef = await prisma.connectorDefinition.findUnique({
          where: { key: input.connectorKey.toLowerCase() },
        });
        if (dbDef) {
          return dbDef.id;
        }
      } catch {
        // Fall through
      }

      const seed = connectorRegistry.getSeedByKey(input.connectorKey);
      if (seed) {
        try {
          const created = await prisma.connectorDefinition.upsert({
            where: { key: seed.key },
            update: {
              name: seed.name,
              description: seed.description,
              type: seed.type,
              supportedAuth: seed.supportedAuth,
              iconUrl: null,
              docUrl: seed.docUrl,
              defaultConfig: seed.defaultConfig || {},
            },
            create: {
              key: seed.key,
              name: seed.name,
              description: seed.description,
              type: seed.type,
              supportedAuth: seed.supportedAuth,
              iconUrl: null,
              docUrl: seed.docUrl,
              isSystem: true,
              defaultConfig: seed.defaultConfig || {},
            },
          });
          return created.id;
        } catch {
          return connectorRegistry.getStableUuid(seed.key);
        }
      }
    }

    throw new BadRequestError('Either a valid connectorDefinitionId or connectorKey is required');
  }

  /**
   * The single authoritative writer of connection status across the platform.
   */
  async updateConnectionStatus(
    connectionId: string,
    status: ConnectionStatus,
    options?: {
      lastErrorMessage?: string | null;
      lastConnectedAt?: Date | null;
      lastTestedAt?: Date | null;
      lastDiscoveredAt?: Date | null;
    }
  ): Promise<void> {
    try {
      const data: any = { status };
      if (options?.lastErrorMessage !== undefined) {
        data.lastErrorMessage = options.lastErrorMessage;
      }
      if (options?.lastConnectedAt !== undefined) {
        data.lastConnectedAt = options.lastConnectedAt;
      }
      if (options?.lastTestedAt !== undefined) {
        data.lastTestedAt = options.lastTestedAt;
      }
      if (options?.lastDiscoveredAt !== undefined) {
        data.lastDiscoveredAt = options.lastDiscoveredAt;
      }

      await prisma.connectorConnection.update({
        where: { id: connectionId },
        data,
      });
    } catch (err: any) {
      logger.warn(`[ConnectionService] Failed to update connection status for '${connectionId}': ${err.message}`);
    }
  }

  /**
   * Creates a new connection instance with encrypted credentials.
   */
  async createConnection(
    workspaceId: string,
    userId: string,
    input: CreateConnectionDTO
  ): Promise<ConnectionResponseDTO> {
    if (input.baseUrl) {
      await ssrfGuard.assertSafeUrl(input.baseUrl);
    }

    const definitionId = await this.resolveDefinitionId(input);

    const connection = await prisma.$transaction(async (tx) => {
      const created = await tx.connectorConnection.create({
        data: {
          workspaceId,
          userId,
          connectorDefinitionId: definitionId,
          name: input.name,
          authType: input.authType,
          baseUrl: input.baseUrl || null,
          mcpTransport: input.mcpTransport || null,
          config: input.config ?? undefined,
          status: input.credentials ? 'CONNECTED' : 'INITIALIZING',
        },
        include: {
          connectorDefinition: { select: { key: true } },
        },
      });

      if (input.credentials && Object.keys(input.credentials).length > 0) {
        const encrypted = credentialVaultService.encrypt(input.credentials);
        await tx.connectorCredential.create({
          data: {
            connectionId: created.id,
            encryptedData: encrypted.encryptedData,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
            keyId: encrypted.keyId,
            expiresAt: input.credentials.expiresAt ? new Date(input.credentials.expiresAt) : null,
            refreshTokenExpiresAt: input.credentials.refreshTokenExpiresAt ? new Date(input.credentials.refreshTokenExpiresAt) : null,
            tokenType: input.credentials.tokenType || null,
            scopes: input.credentials.scopes || [],
          },
        });
      }

      return created;
    });

    return {
      id: connection.id,
      workspaceId: connection.workspaceId,
      userId: connection.userId,
      connectorDefinitionId: connection.connectorDefinitionId,
      connectorKey: (connection as any).connectorDefinition?.key || input.connectorKey,
      name: connection.name,
      status: connection.status,
      authType: connection.authType,
      baseUrl: connection.baseUrl,
      mcpTransport: connection.mcpTransport,
      config: connection.config as any,
      hasCredentials: Boolean(input.credentials),
      lastConnectedAt: connection.lastConnectedAt,
      lastTestedAt: connection.lastTestedAt,
      lastErrorMessage: connection.lastErrorMessage,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
      toolsCount: 0,
    };
  }

  /**
   * Retrieves connections belonging to the workspace.
   */
  async listConnections(workspaceId: string): Promise<ConnectionResponseDTO[]> {
    const connections = await prisma.connectorConnection.findMany({
      where: { workspaceId },
      include: {
        connectorDefinition: { select: { key: true } },
        credential: { select: { id: true } },
        _count: { select: { tools: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return connections.map((conn) => ({
      id: conn.id,
      workspaceId: conn.workspaceId,
      userId: conn.userId,
      connectorDefinitionId: conn.connectorDefinitionId,
      connectorKey: conn.connectorDefinition?.key,
      name: conn.name,
      status: conn.status,
      authType: conn.authType,
      baseUrl: conn.baseUrl,
      mcpTransport: conn.mcpTransport,
      config: conn.config as any,
      hasCredentials: Boolean(conn.credential),
      lastConnectedAt: conn.lastConnectedAt,
      lastTestedAt: conn.lastTestedAt,
      lastErrorMessage: conn.lastErrorMessage,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
      toolsCount: conn._count?.tools || 0,
    }));
  }

  /**
   * Retrieves a single connection by ID, ensuring workspace ownership.
   */
  async getConnectionById(connectionId: string, workspaceId: string): Promise<ConnectionResponseDTO> {
    const conn = await prisma.connectorConnection.findFirst({
      where: { id: connectionId, workspaceId },
      include: {
        connectorDefinition: { select: { key: true } },
        credential: { select: { id: true } },
        _count: { select: { tools: true } },
      },
    });

    if (!conn) {
      throw new NotFoundError(`Connection '${connectionId}' not found in workspace`);
    }

    return {
      id: conn.id,
      workspaceId: conn.workspaceId,
      userId: conn.userId,
      connectorDefinitionId: conn.connectorDefinitionId,
      connectorKey: conn.connectorDefinition?.key,
      name: conn.name,
      status: conn.status,
      authType: conn.authType,
      baseUrl: conn.baseUrl,
      mcpTransport: conn.mcpTransport,
      config: conn.config as any,
      hasCredentials: Boolean(conn.credential),
      lastConnectedAt: conn.lastConnectedAt,
      lastTestedAt: conn.lastTestedAt,
      lastErrorMessage: conn.lastErrorMessage,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
      toolsCount: conn._count?.tools || 0,
    };
  }

  /**
   * Updates an existing connection and updates credentials if provided.
   */
  async updateConnection(
    connectionId: string,
    workspaceId: string,
    input: UpdateConnectionDTO
  ): Promise<ConnectionResponseDTO> {
    if (input.baseUrl) {
      await ssrfGuard.assertSafeUrl(input.baseUrl);
    }

    const existing = await prisma.connectorConnection.findFirst({
      where: { id: connectionId, workspaceId },
    });

    if (!existing) {
      throw new NotFoundError(`Connection '${connectionId}' not found in workspace`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.connectorConnection.update({
        where: { id: connectionId },
        data: {
          name: input.name ?? undefined,
          baseUrl: input.baseUrl ?? undefined,
          mcpTransport: input.mcpTransport ?? undefined,
          config: input.config ?? undefined,
          status: input.status ?? undefined,
        },
      });

      if (input.credentials && Object.keys(input.credentials).length > 0) {
        const encrypted = credentialVaultService.encrypt(input.credentials);
        await tx.connectorCredential.upsert({
          where: { connectionId },
          update: {
            encryptedData: encrypted.encryptedData,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
            keyId: encrypted.keyId,
            expiresAt: input.credentials.expiresAt ? new Date(input.credentials.expiresAt) : undefined,
            refreshTokenExpiresAt: input.credentials.refreshTokenExpiresAt ? new Date(input.credentials.refreshTokenExpiresAt) : undefined,
          },
          create: {
            connectionId,
            encryptedData: encrypted.encryptedData,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
            keyId: encrypted.keyId,
            expiresAt: input.credentials.expiresAt ? new Date(input.credentials.expiresAt) : null,
            refreshTokenExpiresAt: input.credentials.refreshTokenExpiresAt ? new Date(input.credentials.refreshTokenExpiresAt) : null,
          },
        });
      }
    });

    return this.getConnectionById(connectionId, workspaceId);
  }

  /**
   * Deletes a connection and cascades to credentials, tools, permissions, and bindings.
   */
  async deleteConnection(connectionId: string, workspaceId: string): Promise<boolean> {
    const existing = await prisma.connectorConnection.findFirst({
      where: { id: connectionId, workspaceId },
    });

    if (!existing) {
      throw new NotFoundError(`Connection '${connectionId}' not found in workspace`);
    }

    await prisma.connectorConnection.delete({
      where: { id: connectionId },
    });

    return true;
  }

  /**
   * Triggers tool, resource, and prompt discovery on an active connection.
   * If a native adapter exists, always uses it regardless of stored definition type.
   * MCP discovery is used only for type MCP connections.
   */
  async discoverConnection(connectionId: string, workspaceId: string) {
    const conn = await prisma.connectorConnection.findFirst({
      where: { id: connectionId, workspaceId },
      include: { connectorDefinition: true },
    });

    if (!conn) {
      throw new NotFoundError(`Connection '${connectionId}' not found in workspace`);
    }

    const { nativeAdapterRegistry } = await import('../adapters/native/native-adapter.registry');
    const key = conn.connectorDefinition.key.toLowerCase();

    // 1. Native adapter has highest priority
    if (nativeAdapterRegistry.hasAdapter(key)) {
      const adapter = nativeAdapterRegistry.getAdapter(key)!;
      try {
        const tools = await adapter.discoverTools({
          id: conn.id,
          name: conn.name,
          workspaceId: conn.workspaceId,
          userId: conn.userId,
          connectorKey: key,
          authType: conn.authType,
          baseUrl: conn.baseUrl,
          config: conn.config as any,
        });

        for (const t of tools) {
          await prisma.connectorTool.upsert({
            where: {
              connectionId_name: {
                connectionId,
                name: t.name,
              },
            },
            update: {
              displayName: t.displayName,
              description: t.description,
              inputSchema: t.inputSchema,
              requiresApproval: t.requiresApproval || false,
              rateLimitPerMin: t.rateLimitPerMin || 60,
              updatedAt: new Date(),
            },
            create: {
              connectionId,
              name: t.name,
              displayName: t.displayName,
              description: t.description,
              inputSchema: t.inputSchema,
              requiresApproval: t.requiresApproval || false,
              rateLimitPerMin: t.rateLimitPerMin || 60,
              isEnabled: true,
            },
          }).catch(() => {});
        }

        await this.updateConnectionStatus(connectionId, 'CONNECTED', {
          lastDiscoveredAt: new Date(),
          lastConnectedAt: new Date(),
          lastErrorMessage: null,
        });

        return {
          toolsCount: tools.length,
          resourcesCount: 0,
          promptsCount: 0,
          tools,
        };
      } catch (err: any) {
        await this.updateConnectionStatus(connectionId, 'ERROR', {
          lastErrorMessage: err.message || 'Native tool discovery failed',
        });
        throw err;
      }
    }

    // 2. MCP connections
    if (conn.connectorDefinition.type === 'MCP') {
      try {
        const mcpDiscoveryService = (await import('../mcp/mcp-discovery.service')).default;
        const result = await mcpDiscoveryService.discoverAll(connectionId);
        await this.updateConnectionStatus(connectionId, 'CONNECTED', {
          lastDiscoveredAt: new Date(),
          lastConnectedAt: new Date(),
          lastErrorMessage: null,
        });
        return result;
      } catch (err: any) {
        await this.updateConnectionStatus(connectionId, 'ERROR', {
          lastErrorMessage: err.message || 'MCP tool discovery failed',
        });
        throw err;
      }
    }

    // 3. Custom REST connections
    if (conn.connectorDefinition.type === 'CUSTOM_REST') {
      try {
        const customRestAdapter = (await import('../adapters/rest/custom-rest.adapter')).default;
        const tools = await customRestAdapter.discoverTools({
          id: conn.id,
          name: conn.name,
          workspaceId: conn.workspaceId,
          userId: conn.userId,
          connectorKey: key,
          authType: conn.authType,
          baseUrl: conn.baseUrl,
          config: conn.config as any,
        });

        for (const t of tools) {
          await prisma.connectorTool.upsert({
            where: {
              connectionId_name: {
                connectionId,
                name: t.name,
              },
            },
            update: {
              displayName: t.displayName,
              description: t.description,
              inputSchema: t.inputSchema,
              requiresApproval: t.requiresApproval || false,
              rateLimitPerMin: t.rateLimitPerMin || 60,
              updatedAt: new Date(),
            },
            create: {
              connectionId,
              name: t.name,
              displayName: t.displayName,
              description: t.description,
              inputSchema: t.inputSchema,
              requiresApproval: t.requiresApproval || false,
              rateLimitPerMin: t.rateLimitPerMin || 60,
              isEnabled: true,
            },
          }).catch(() => {});
        }

        await this.updateConnectionStatus(connectionId, 'CONNECTED', {
          lastDiscoveredAt: new Date(),
          lastConnectedAt: new Date(),
          lastErrorMessage: null,
        });

        return {
          toolsCount: tools.length,
          resourcesCount: 0,
          promptsCount: 0,
          tools,
        };
      } catch (err: any) {
        await this.updateConnectionStatus(connectionId, 'ERROR', {
          lastErrorMessage: err.message || 'REST tool discovery failed',
        });
        throw err;
      }
    }

    throw new BadRequestError(`Unsupported connector type '${conn.connectorDefinition.type}' for discovery`);
  }

  /**
   * Retrieves all discovered tools for a connection.
   */
  async getConnectionTools(connectionId: string, workspaceId: string) {
    await this.getConnectionById(connectionId, workspaceId);
    return prisma.connectorTool.findMany({
      where: { connectionId },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Retrieves all discovered resources for a connection.
   */
  async getConnectionResources(connectionId: string, workspaceId: string) {
    await this.getConnectionById(connectionId, workspaceId);
    return prisma.connectorResource.findMany({
      where: { connectionId },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Retrieves all discovered prompt templates for a connection.
   */
  async getConnectionPrompts(connectionId: string, workspaceId: string) {
    await this.getConnectionById(connectionId, workspaceId);
    return prisma.connectorPrompt.findMany({
      where: { connectionId },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Executes a diagnostic ping / health check on a connection.
   * If a native adapter exists, always uses it. MCP ping is only used for type MCP connections.
   */
  async testConnection(connectionId: string, workspaceId: string) {
    const conn = await prisma.connectorConnection.findFirst({
      where: { id: connectionId, workspaceId },
      include: { connectorDefinition: true },
    });

    if (!conn) {
      throw new NotFoundError(`Connection '${connectionId}' not found in workspace`);
    }

    const { nativeAdapterRegistry } = await import('../adapters/native/native-adapter.registry');
    const key = conn.connectorDefinition.key.toLowerCase();

    // 1. Native adapter
    if (nativeAdapterRegistry.hasAdapter(key)) {
      const adapter = nativeAdapterRegistry.getAdapter(key)!;
      const result = await adapter.testConnection({
        id: conn.id,
        name: conn.name,
        workspaceId: conn.workspaceId,
        userId: conn.userId,
        connectorKey: key,
        authType: conn.authType,
        baseUrl: conn.baseUrl,
        config: conn.config as any,
      });

      await this.updateConnectionStatus(connectionId, result.status, {
        lastTestedAt: result.testedAt || new Date(),
        lastErrorMessage: result.isHealthy ? null : result.message,
        lastConnectedAt: result.isHealthy ? new Date() : undefined,
      });

      return {
        isHealthy: result.isHealthy,
        latencyMs: result.details?.latencyMs || 0,
        message: result.message,
        error: result.isHealthy ? undefined : result.message,
      };
    }

    // 2. MCP connection
    if (conn.connectorDefinition.type === 'MCP') {
      try {
        const mcpClientManager = (await import('../mcp/mcp-client.manager')).default;
        const result = await mcpClientManager.pingConnection(connectionId);
        await this.updateConnectionStatus(connectionId, result.isHealthy ? 'CONNECTED' : 'ERROR', {
          lastTestedAt: new Date(),
          lastErrorMessage: result.isHealthy ? null : (result.error || 'MCP ping failed'),
          lastConnectedAt: result.isHealthy ? new Date() : undefined,
        });
        return result;
      } catch (err: any) {
        await this.updateConnectionStatus(connectionId, 'ERROR', {
          lastTestedAt: new Date(),
          lastErrorMessage: err.message || 'MCP ping error',
        });
        return {
          isHealthy: false,
          latencyMs: 0,
          message: err.message,
          error: err.message,
        };
      }
    }

    // 3. Custom REST connection
    if (conn.connectorDefinition.type === 'CUSTOM_REST') {
      const customRestAdapter = (await import('../adapters/rest/custom-rest.adapter')).default;
      const result = await customRestAdapter.testConnection({
        id: conn.id,
        name: conn.name,
        workspaceId: conn.workspaceId,
        userId: conn.userId,
        connectorKey: key,
        authType: conn.authType,
        baseUrl: conn.baseUrl,
        config: conn.config as any,
      });

      await this.updateConnectionStatus(connectionId, result.status, {
        lastTestedAt: result.testedAt || new Date(),
        lastErrorMessage: result.isHealthy ? null : result.message,
        lastConnectedAt: result.isHealthy ? new Date() : undefined,
      });

      return {
        isHealthy: result.isHealthy,
        latencyMs: result.details?.latencyMs || 0,
        message: result.message,
        error: result.isHealthy ? undefined : result.message,
      };
    }

    throw new BadRequestError(`Unsupported connector type '${conn.connectorDefinition.type}' for test`);
  }

  /**
   * Executes a specific tool on a connection.
   */
  async executeTool(
    connectionId: string,
    workspaceId: string,
    toolName: string,
    parameters: Record<string, any>
  ) {
    await this.getConnectionById(connectionId, workspaceId);
    const executionEngineService = (await import('../execution/execution-engine.service')).default;
    return executionEngineService.executeTool({
      connectionId,
      workspaceId,
      toolName,
      parameters,
    });
  }

  /**
   * Shared /connect workflow:
   * - Token/API-key/Basic: creates connection, stores credentials in vault, tests, discovers tools.
   *   If any step fails, rolls back (deletes created connection and credentials).
   * - OAuth2: returns { authUrl }.
   */
  async connect(
    workspaceId: string,
    userId: string,
    input: ConnectRequestDTO
  ): Promise<ConnectResultDTO> {
    if (!input.connectorKey || typeof input.connectorKey !== 'string') {
      const err = new Error('connectorKey is required');
      (err as any).code = 'VALIDATION_ERROR';
      throw err;
    }

    if (!input.authType) {
      const err = new Error('authType is required');
      (err as any).code = 'VALIDATION_ERROR';
      throw err;
    }

    const key = input.connectorKey.toLowerCase();
    const seed = connectorRegistry.getSeedByKey(key);
    if (!seed) {
      const err = new Error(`Connector definition '${input.connectorKey}' not found in catalog`);
      (err as any).code = 'VALIDATION_ERROR';
      throw err;
    }

    if (seed.requiresBaseUrl && (!input.baseUrl || !input.baseUrl.trim())) {
      const err = new Error(`Base URL is required for ${seed.name}`);
      (err as any).code = 'VALIDATION_ERROR';
      throw err;
    }

    // SSRF validation if baseUrl is provided
    if (input.baseUrl) {
      await ssrfGuard.assertSafeUrl(input.baseUrl);
    }

    // 1. OAuth2 Authorization Code flow
    if (input.authType === 'OAUTH2_AUTHORIZATION_CODE') {
      const oauthAvailable = connectorRegistry.computeOAuthAvailable(key);
      if (!oauthAvailable) {
        const err = new Error(
          `OAuth 2.0 is not configured for ${seed.name}. Please connect using direct credentials (API Token / Key / Basic Auth).`
        );
        (err as any).code = 'OAUTH_NOT_CONFIGURED';
        throw err;
      }

      // Create connection in INITIALIZING state
      const connection = await this.createConnection(workspaceId, userId, {
        connectorKey: key,
        name: input.name || `${seed.name} Connection`,
        authType: input.authType,
        baseUrl: input.baseUrl,
        mcpTransport: input.mcpTransport,
      });

      const { authorizationUrl } = await authManager.initiateOAuth(connection.id, workspaceId);
      return { authUrl: authorizationUrl };
    }

    // 2. Direct credentials flow (Token, API Key, Basic Auth, None, Custom Headers)
    if (input.authType !== 'NONE') {
      if (!input.credentials || Object.keys(input.credentials).length === 0) {
        const err = new Error(`Credentials are required for auth type '${input.authType}'`);
        (err as any).code = 'INVALID_CREDENTIALS';
        throw err;
      }
    }

    let createdConnectionId: string | null = null;
    try {
      // 1. Create connection and store credentials
      const created = await this.createConnection(workspaceId, userId, {
        connectorKey: key,
        name: input.name || `${seed.name} Connection`,
        authType: input.authType,
        baseUrl: input.baseUrl,
        mcpTransport: input.mcpTransport,
        credentials: input.credentials,
      });
      createdConnectionId = created.id;

      // 2. Health ping / test
      const testResult = await this.testConnection(createdConnectionId, workspaceId);
      if (!testResult.isHealthy) {
        const message = testResult.error || (testResult as any).message || 'Authentication failed: credentials rejected by upstream service';
        const err = new Error(message);
        (err as any).code = 'INVALID_CREDENTIALS';
        throw err;
      }

      // 3. Discover tools
      let toolsCount = 0;
      try {
        const discoveryResult = await this.discoverConnection(createdConnectionId, workspaceId);
        toolsCount = discoveryResult.toolsCount || (discoveryResult.tools?.length ?? 0);
      } catch (discErr: any) {
        const err = new Error(discErr?.message || 'Tool discovery failed on new connection');
        (err as any).code = 'DISCOVERY_FAILED';
        throw err;
      }

      // 4. Update status to CONNECTED
      await this.updateConnectionStatus(createdConnectionId, 'CONNECTED', {
        lastConnectedAt: new Date(),
        lastErrorMessage: null,
      });

      const finalConnection = await this.getConnectionById(createdConnectionId, workspaceId);
      return {
        connection: finalConnection,
        toolsCount,
      };
    } catch (err: any) {
      // ROLLBACK on failure: delete newly created connection and credentials
      if (createdConnectionId) {
        try {
          await this.deleteConnection(createdConnectionId, workspaceId);
        } catch (delErr: any) {
          logger.warn(`[ConnectionService] Rollback delete failed for '${createdConnectionId}': ${delErr.message}`);
        }
      }
      throw err;
    }
  }
}

export const connectionService = new ConnectionService();
export default connectionService;
