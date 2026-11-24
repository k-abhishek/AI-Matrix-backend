import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpTransportType } from '@prisma/client';
import prisma from '../../lib/prisma';
import ssrfGuard from '../../lib/network/ssrf-guard';
import mcpTransportManager from './transports/mcp-transport.manager';
import mcpAuthManager from './mcp-auth.manager';
import { McpClientSession, McpTransportOptions } from './mcp.types';
import { NotFoundError, AppError } from '../../lib/errors';
import logger from '../../lib/logger';

export class McpClientManager {
  private sessions: Map<string, McpClientSession> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

  constructor() {
    // Start idle cleanup check every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.evictIdleSessions();
    }, 5 * 60 * 1000);

    // Unref so cleanup timer does not prevent process exit in tests
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Retrieves an active, connected MCP client for a specific connection.
   * If an active session exists, it is reused. Otherwise, a new session is initialized.
   */
  async getClient(connectionId: string): Promise<Client> {
    const existing = this.sessions.get(connectionId);
    if (existing && existing.isAlive) {
      existing.lastUsedAt = new Date();
      return existing.client;
    }

    // If an inactive session exists, close it cleanly
    if (existing) {
      await this.closeSession(connectionId);
    }

    return this.createSession(connectionId);
  }

  /**
   * Creates, handshakes, and registers a new MCP client session for a connection.
   */
  async createSession(connectionId: string): Promise<Client> {
    const connection = await prisma.connectorConnection.findUnique({
      where: { id: connectionId },
      include: {
        connectorDefinition: true,
      },
    });

    if (!connection) {
      throw new NotFoundError(`Connector connection '${connectionId}' not found`);
    }

    if (connection.connectorDefinition?.type !== 'MCP') {
      throw new AppError(
        `Cannot create MCP session for non-MCP connection '${connection.name}' (${connection.connectorDefinition?.type})`,
        400
      );
    }

    // Determine target URL: prefer connection.baseUrl, then definition.serverUrl
    const rawUrl = connection.baseUrl || (connection.connectorDefinition?.defaultConfig as any)?.serverUrl;
    if (!rawUrl) {
      throw new AppError(`Connection '${connection.name}' (${connectionId}) has no configured MCP server URL`, 400);
    }

    await ssrfGuard.assertSafeUrl(rawUrl);

    const transportType = connection.mcpTransport || McpTransportType.STREAMABLE_HTTP;
    const authHeaders = await mcpAuthManager.getAuthHeaders(connectionId);

    const transportOptions: McpTransportOptions = {
      serverUrl: rawUrl,
      transportType,
      headers: authHeaders,
      timeoutMs: (connection.config as any)?.timeoutMs || 30000,
    };

    const transport = mcpTransportManager.createTransport(transportOptions);

    const client = new Client(
      {
        name: 'AI-Matrix-Connector-Platform',
        version: '1.0.0',
      },
      {
        capabilities: {
          roots: { listChanged: true },
        },
      }
    );

    const session: McpClientSession = {
      client,
      transport,
      connectionId,
      serverUrl: rawUrl,
      transportType,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      isAlive: true,
    };

    transport.onclose = () => {
      logger.info(`[McpClientManager] Transport closed for connection '${connectionId}'`);
      session.isAlive = false;
    };

    transport.onerror = (err: any) => {
      logger.warn(`[McpClientManager] Transport error for connection '${connectionId}': ${err?.message || err}`);
      session.isAlive = false;
    };

    try {
      logger.info(`[McpClientManager] Connecting MCP client to ${rawUrl} (connection: ${connectionId})`);
      await client.connect(transport);

      session.serverCapabilities = client.getServerCapabilities();
      this.sessions.set(connectionId, session);

      // Update connection status in PostgreSQL
      await prisma.connectorConnection.update({
        where: { id: connectionId },
        data: {
          lastConnectedAt: new Date(),
          status: 'CONNECTED',
          lastErrorMessage: null,
        },
      }).catch((err) => {
        logger.warn(`[McpClientManager] Could not update connection status in DB: ${err.message}`);
      });

      return client;
    } catch (err: any) {
      session.isAlive = false;
      await this.closeSession(connectionId);
      logger.error(`[McpClientManager] Failed to connect MCP client to ${rawUrl}:`, err);

      if (connection.connectorDefinition?.type === 'MCP') {
        await prisma.connectorConnection.update({
          where: { id: connectionId },
          data: {
            status: 'ERROR',
            lastErrorMessage: err.message || 'Failed to establish MCP handshake',
          },
        }).catch(() => {});
      }

      throw new AppError(`MCP handshake failed with server '${rawUrl}': ${err.message}`, 502);
    }
  }

  /**
   * Pings an active connection to test reachability and protocol responsiveness.
   */
  async pingConnection(connectionId: string): Promise<{ isHealthy: boolean; latencyMs: number; error?: string }> {
    const startTime = Date.now();
    try {
      const client = await this.getClient(connectionId);
      await client.ping();
      const latencyMs = Date.now() - startTime;

      await prisma.connectorConnection.update({
        where: { id: connectionId },
        data: {
          lastTestedAt: new Date(),
          status: 'CONNECTED',
          lastErrorMessage: null,
        },
      }).catch(() => {});

      return { isHealthy: true, latencyMs };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      logger.warn(`[McpClientManager] Ping failed for connection '${connectionId}':`, err);

      await prisma.connectorConnection.update({
        where: { id: connectionId },
        data: {
          lastTestedAt: new Date(),
          status: 'ERROR',
          lastErrorMessage: err.message || 'Ping failed',
        },
      }).catch(() => {});

      return { isHealthy: false, latencyMs, error: err.message };
    }
  }

  /**
   * Creates an ephemeral, unpooled client instance (useful for probing unknown servers).
   */
  async createEphemeralClient(
    serverUrl: string,
    transportType: McpTransportType = McpTransportType.STREAMABLE_HTTP,
    headers: Record<string, string> = {}
  ): Promise<{ client: Client; transport: any }> {
    await ssrfGuard.assertSafeUrl(serverUrl);

    const transport = mcpTransportManager.createTransport({
      serverUrl,
      transportType,
      headers,
    });

    const client = new Client(
      {
        name: 'AI-Matrix-Probe',
        version: '1.0.0',
      },
      {
        capabilities: {
          roots: { listChanged: true },
        },
      }
    );

    await client.connect(transport);
    return { client, transport };
  }

  /**
   * Closes and removes a specific connection session.
   */
  async closeSession(connectionId: string): Promise<void> {
    const session = this.sessions.get(connectionId);
    if (session) {
      session.isAlive = false;
      this.sessions.delete(connectionId);
      try {
        await session.client.close();
      } catch (err: any) {
        logger.debug(`[McpClientManager] Error closing client '${connectionId}': ${err.message}`);
      }
    }
  }

  /**
   * Gracefully evicts sessions idle for longer than IDLE_TIMEOUT_MS.
   */
  private evictIdleSessions(): void {
    const now = Date.now();
    for (const [connectionId, session] of this.sessions.entries()) {
      if (now - session.lastUsedAt.getTime() > this.IDLE_TIMEOUT_MS) {
        logger.debug(`[McpClientManager] Evicting idle MCP session for connection '${connectionId}'`);
        this.closeSession(connectionId).catch(() => {});
      }
    }
  }

  /**
   * Cleans up all active sessions (e.g. during application shutdown).
   */
  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    const closePromises = Array.from(this.sessions.keys()).map((id) => this.closeSession(id));
    await Promise.allSettled(closePromises);
    this.sessions.clear();
  }
}

export const mcpClientManager = new McpClientManager();
export default mcpClientManager;
