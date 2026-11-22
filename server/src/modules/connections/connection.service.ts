import prisma from '../../lib/prisma';
import credentialVaultService from '../../lib/vault/credential-vault.service';
import ssrfGuard from '../../lib/network/ssrf-guard';
import { NotFoundError, BadRequestError } from '../../lib/errors';
import { CreateConnectionDTO, UpdateConnectionDTO, ConnectionResponseDTO } from './connection.types';
import connectorService from '../connectors/connector.service';

export class ConnectionService {
  /**
   * Resolves the connector definition ID either from definitionId or connectorKey.
   */
  private async resolveDefinitionId(input: CreateConnectionDTO): Promise<string> {
    if (input.connectorDefinitionId) {
      return input.connectorDefinitionId;
    }

    if (input.connectorKey) {
      const def = await connectorService.getDefinitionByKey(input.connectorKey);
      // If definition exists in DB
      const dbDef = await prisma.connectorDefinition.findUnique({
        where: { key: input.connectorKey },
      });
      if (dbDef) {
        return dbDef.id;
      }
      // If it was a seed, make sure it's upserted
      const created = await prisma.connectorDefinition.upsert({
        where: { key: def.key },
        update: {},
        create: {
          key: def.key,
          name: def.name,
          description: def.description,
          type: def.type,
          supportedAuth: def.supportedAuth,
          iconUrl: def.iconUrl,
          docUrl: def.docUrl,
          isSystem: true,
          defaultConfig: def.defaultConfig ?? undefined,
        },
      });
      return created.id;
    }

    throw new BadRequestError('Either connectorDefinitionId or connectorKey is required');
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
      connectorKey: (connection as any).connectorDefinition?.key,
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
   * If the connection is NATIVE, delegates to its Native Adapter.
   * If MCP discovery fails and a native adapter exists, gracefully falls back to native discovery.
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
    const key = conn.connectorDefinition.key;
    const isNative = conn.connectorDefinition.type === 'NATIVE';

    if (isNative && nativeAdapterRegistry.hasAdapter(key)) {
      const adapter = nativeAdapterRegistry.getAdapter(key)!;
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

      return {
        toolsCount: tools.length,
        resourcesCount: 0,
        promptsCount: 0,
        tools,
      };
    }

    try {
      const mcpDiscoveryService = (await import('../mcp/mcp-discovery.service')).default;
      return await mcpDiscoveryService.discoverAll(connectionId);
    } catch (err: any) {
      if (nativeAdapterRegistry.hasAdapter(key)) {
        const adapter = nativeAdapterRegistry.getAdapter(key)!;
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

        return {
          toolsCount: tools.length,
          resourcesCount: 0,
          promptsCount: 0,
          tools,
        };
      }
      throw err;
    }
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
   * If the connection is NATIVE, runs the Native Adapter's testConnection.
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
    const key = conn.connectorDefinition.key;
    const isNative = conn.connectorDefinition.type === 'NATIVE';

    if (isNative && nativeAdapterRegistry.hasAdapter(key)) {
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

      await prisma.connectorConnection.update({
        where: { id: connectionId },
        data: {
          status: result.status,
          lastTestedAt: result.testedAt,
          lastErrorMessage: result.isHealthy ? null : result.message,
        },
      }).catch(() => {});

      return {
        isHealthy: result.isHealthy,
        latencyMs: result.details?.latencyMs || 0,
        message: result.message,
        error: result.isHealthy ? undefined : result.message,
      };
    }

    try {
      const mcpClientManager = (await import('../mcp/mcp-client.manager')).default;
      return await mcpClientManager.pingConnection(connectionId);
    } catch (err: any) {
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

        await prisma.connectorConnection.update({
          where: { id: connectionId },
          data: {
            status: result.status,
            lastTestedAt: result.testedAt,
            lastErrorMessage: result.isHealthy ? null : result.message,
          },
        }).catch(() => {});

        return {
          isHealthy: result.isHealthy,
          latencyMs: result.details?.latencyMs || 0,
          message: result.message,
          error: result.isHealthy ? undefined : result.message,
        };
      }
      throw err;
    }
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
}

export const connectionService = new ConnectionService();
export default connectionService;
