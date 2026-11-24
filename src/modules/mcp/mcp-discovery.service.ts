import crypto from 'crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpTransportType } from '@prisma/client';
import prisma from '../../lib/prisma';
import mcpClientManager from './mcp-client.manager';
import {
  McpDiscoveredTool,
  McpDiscoveredResource,
  McpDiscoveredPrompt,
  McpDiscoverySummary,
  McpProbeResult,
} from './mcp.types';
import logger from '../../lib/logger';

export class McpDiscoveryService {
  /**
   * Discovers tools from an MCP server and synchronizes them into PostgreSQL.
   */
  async discoverTools(connectionId: string, activeClient?: Client): Promise<McpDiscoveredTool[]> {
    const client = activeClient || (await mcpClientManager.getClient(connectionId));
    logger.info(`[McpDiscoveryService] Discovering tools for connection '${connectionId}'`);

    const response = await client.listTools();
    const rawTools = response.tools || [];
    const discoveredTools: McpDiscoveredTool[] = [];

    for (const raw of rawTools) {
      const sanitizedDesc = this.sanitizeDescription(raw.description || '');
      const inputSchema = (raw.inputSchema as Record<string, any>) || { type: 'object', properties: {} };
      const schemaHash = crypto.createHash('sha256').update(JSON.stringify(inputSchema)).digest('hex');
      const isDestructive = this.isDestructiveOperation(raw.name, sanitizedDesc);

      const tool: McpDiscoveredTool = {
        name: raw.name,
        displayName: this.formatDisplayName(raw.name),
        description: sanitizedDesc,
        inputSchema,
        schemaHash,
        requiresApproval: isDestructive,
      };

      discoveredTools.push(tool);

      // Persist to PostgreSQL
      await prisma.connectorTool.upsert({
        where: {
          connectionId_name: {
            connectionId,
            name: tool.name,
          },
        },
        update: {
          displayName: tool.displayName,
          description: tool.description,
          inputSchema: tool.inputSchema,
          schemaHash: tool.schemaHash,
          requiresApproval: isDestructive,
          updatedAt: new Date(),
        },
        create: {
          connectionId,
          name: tool.name,
          displayName: tool.displayName,
          description: tool.description,
          inputSchema: tool.inputSchema,
          schemaHash: tool.schemaHash,
          isEnabled: true,
          requiresApproval: isDestructive,
        },
      }).catch((err) => {
        logger.warn(`[McpDiscoveryService] Error upserting tool '${tool.name}': ${err.message}`);
      });
    }

    logger.info(`[McpDiscoveryService] Discovered ${discoveredTools.length} tools for connection '${connectionId}'`);
    return discoveredTools;
  }

  /**
   * Discovers resources from an MCP server and synchronizes them into PostgreSQL.
   */
  async discoverResources(connectionId: string, activeClient?: Client): Promise<McpDiscoveredResource[]> {
    const client = activeClient || (await mcpClientManager.getClient(connectionId));
    logger.info(`[McpDiscoveryService] Discovering resources for connection '${connectionId}'`);

    let rawResources: any[] = [];
    try {
      const response = await client.listResources();
      rawResources = response.resources || [];
    } catch (err: any) {
      logger.debug(`[McpDiscoveryService] Server does not support resources or error: ${err.message}`);
      return [];
    }

    const discovered: McpDiscoveredResource[] = [];

    for (const raw of rawResources) {
      const res: McpDiscoveredResource = {
        uri: raw.uri,
        name: raw.name || raw.uri,
        description: raw.description ? this.sanitizeDescription(raw.description) : undefined,
        mimeType: raw.mimeType,
      };
      discovered.push(res);

      await prisma.connectorResource.upsert({
        where: {
          connectionId_uri: {
            connectionId,
            uri: res.uri,
          },
        },
        update: {
          name: res.name,
          description: res.description,
          mimeType: res.mimeType,
          updatedAt: new Date(),
        },
        create: {
          connectionId,
          uri: res.uri,
          name: res.name,
          description: res.description,
          mimeType: res.mimeType,
        },
      }).catch(() => {});
    }

    return discovered;
  }

  /**
   * Reads the content of an MCP resource.
   */
  async readResource(connectionId: string, uri: string): Promise<any> {
    const client = await mcpClientManager.getClient(connectionId);
    const result = await client.readResource({ uri });

    await prisma.connectorResource.updateMany({
      where: { connectionId, uri },
      data: { lastReadAt: new Date() },
    }).catch(() => {});

    return result;
  }

  /**
   * Discovers prompt templates from an MCP server and synchronizes them into PostgreSQL.
   */
  async discoverPrompts(connectionId: string, activeClient?: Client): Promise<McpDiscoveredPrompt[]> {
    const client = activeClient || (await mcpClientManager.getClient(connectionId));
    logger.info(`[McpDiscoveryService] Discovering prompts for connection '${connectionId}'`);

    let rawPrompts: any[] = [];
    try {
      const response = await client.listPrompts();
      rawPrompts = response.prompts || [];
    } catch (err: any) {
      logger.debug(`[McpDiscoveryService] Server does not support prompts or error: ${err.message}`);
      return [];
    }

    const discovered: McpDiscoveredPrompt[] = [];

    for (const raw of rawPrompts) {
      const p: McpDiscoveredPrompt = {
        name: raw.name,
        description: raw.description ? this.sanitizeDescription(raw.description) : undefined,
        arguments: raw.arguments || [],
      };
      discovered.push(p);

      await prisma.connectorPrompt.upsert({
        where: {
          connectionId_name: {
            connectionId,
            name: p.name,
          },
        },
        update: {
          description: p.description,
          arguments: p.arguments as any,
          updatedAt: new Date(),
        },
        create: {
          connectionId,
          name: p.name,
          description: p.description,
          arguments: p.arguments as any,
        },
      }).catch(() => {});
    }

    return discovered;
  }

  /**
   * Full discovery orchestrator for a connection.
   */
  async discoverAll(connectionId: string): Promise<McpDiscoverySummary> {
    const client = await mcpClientManager.getClient(connectionId);

    const [tools, resources, prompts] = await Promise.all([
      this.discoverTools(connectionId, client),
      this.discoverResources(connectionId, client),
      this.discoverPrompts(connectionId, client),
    ]);

    const discoveredAt = new Date();

    await prisma.connectorConnection.update({
      where: { id: connectionId },
      data: {
        lastDiscoveredAt: discoveredAt,
        configVersion: { increment: 1 },
      },
    }).catch(() => {});

    return {
      connectionId,
      toolsCount: tools.length,
      resourcesCount: resources.length,
      promptsCount: prompts.length,
      tools,
      resources,
      prompts,
      discoveredAt,
    };
  }

  /**
   * Probes an arbitrary remote MCP server ephemeral instance without persisting records to DB.
   */
  async probeServer(
    serverUrl: string,
    transportType: McpTransportType = McpTransportType.STREAMABLE_HTTP,
    headers: Record<string, string> = {}
  ): Promise<McpProbeResult> {
    const startTime = Date.now();
    const { client, transport } = await mcpClientManager.createEphemeralClient(serverUrl, transportType, headers);

    try {
      const serverCapabilities = client.getServerCapabilities() || {};
      const latencyMs = Date.now() - startTime;

      let tools: McpDiscoveredTool[] = [];
      let resources: McpDiscoveredResource[] = [];
      let prompts: McpDiscoveredPrompt[] = [];

      try {
        const toolsRes = await client.listTools();
        tools = (toolsRes.tools || []).map((t) => ({
          name: t.name,
          displayName: this.formatDisplayName(t.name),
          description: this.sanitizeDescription(t.description || ''),
          inputSchema: (t.inputSchema as Record<string, any>) || {},
          schemaHash: crypto.createHash('sha256').update(JSON.stringify(t.inputSchema || {})).digest('hex'),
          requiresApproval: this.isDestructiveOperation(t.name, t.description || ''),
        }));
      } catch {}

      try {
        const resRes = await client.listResources();
        resources = (resRes.resources || []).map((r) => ({
          uri: r.uri,
          name: r.name || r.uri,
          description: r.description ? this.sanitizeDescription(r.description) : undefined,
          mimeType: r.mimeType,
        }));
      } catch {}

      try {
        const promptRes = await client.listPrompts();
        prompts = (promptRes.prompts || []).map((p) => ({
          name: p.name,
          description: p.description ? this.sanitizeDescription(p.description) : undefined,
          arguments: p.arguments || [],
        }));
      } catch {}

      return {
        isHealthy: true,
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: Boolean(serverCapabilities.tools),
          resources: Boolean(serverCapabilities.resources),
          prompts: Boolean(serverCapabilities.prompts),
          logging: Boolean(serverCapabilities.logging),
        },
        tools,
        resources,
        prompts,
        latencyMs,
        testedAt: new Date(),
      };
    } finally {
      try {
        await client.close();
      } catch {}
    }
  }

  /**
   * Sanitizes external tool descriptions to mitigate prompt injection and tool poisoning.
   */
  private sanitizeDescription(raw: string): string {
    if (!raw) return '';
    // Strip control characters and markdown/system delimiters
    const cleaned = raw
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/<system>|<\/system>|\[INST\]|\[\/INST\]|<<SYS>>|<<\/SYS>>/gi, '')
      .trim();

    // Cap at 500 characters
    return cleaned.length > 500 ? cleaned.slice(0, 497) + '...' : cleaned;
  }

  /**
   * Derives human-friendly display name from snake_case or kebab-case identifiers.
   */
  private formatDisplayName(name: string): string {
    return name
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  /**
   * Heuristic to identify operations that must default to Human-in-the-Loop approval.
   */
  private isDestructiveOperation(name: string, description: string): boolean {
    const lower = `${name} ${description}`.toLowerCase();
    const destructiveKeywords = [
      'delete',
      'remove',
      'destroy',
      'drop',
      'terminate',
      'send_email',
      'post_message',
      'purge',
      'revoke',
      'truncate',
    ];
    return destructiveKeywords.some((kw) => lower.includes(kw));
  }
}

export const mcpDiscoveryService = new McpDiscoveryService();
export default mcpDiscoveryService;
