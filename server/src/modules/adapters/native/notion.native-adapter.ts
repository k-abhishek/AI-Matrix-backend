import { BaseNativeAdapter } from './base-native.adapter';
import {
  ConnectorConnectionContext,
  ConnectionHealthResult,
  DiscoveredTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../base.adapter';
import logger from '../../../lib/logger';

export class NotionNativeAdapter extends BaseNativeAdapter {
  readonly connectorType = 'NATIVE' as const;
  readonly connectorKey = 'notion';
  private readonly NOTION_API_URL = 'https://api.notion.com/v1';
  private readonly NOTION_VERSION = '2022-06-28';

  private getToken(creds: Record<string, any>): string {
    return creds.accessToken || creds.apiKey || creds.token || '';
  }

  private getHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'Notion-Version': this.NOTION_VERSION,
      'Content-Type': 'application/json',
    };
  }

  async testConnection(context: ConnectorConnectionContext): Promise<ConnectionHealthResult> {
    const startTime = Date.now();
    const creds = await this.resolveCredentials(context);
    const token = this.getToken(creds);

    if (!token) {
      return {
        status: 'DISCONNECTED',
        isHealthy: false,
        message: 'No Notion Internal Integration Secret / API key provided.',
        testedAt: new Date(),
      };
    }

    if (process.env.NODE_ENV === 'test' && token.includes('mock')) {
      return {
        status: 'CONNECTED',
        isHealthy: true,
        message: 'Notion API connection verified (mock mode)',
        testedAt: new Date(),
        details: { latencyMs: 20 },
      };
    }

    try {
      const res = await fetch(`${this.NOTION_API_URL}/users/me`, {
        method: 'GET',
        headers: this.getHeaders(token),
      });

      const latencyMs = Date.now() - startTime;
      if (!res.ok) {
        const errText = await res.text();
        return {
          status: 'ERROR',
          isHealthy: false,
          message: `Notion authentication failed (${res.status}): ${errText}`,
          testedAt: new Date(),
          details: { latencyMs, status: res.status },
        };
      }

      const bot = await res.json() as any;
      return {
        status: 'CONNECTED',
        isHealthy: true,
        message: `Successfully connected to Notion as bot '${bot.name || 'AI-Matrix Integration'}'`,
        testedAt: new Date(),
        details: { latencyMs, botId: bot.id, name: bot.name },
      };
    } catch (err: any) {
      return {
        status: 'ERROR',
        isHealthy: false,
        message: `Notion connection error: ${err.message}`,
        testedAt: new Date(),
        details: { latencyMs: Date.now() - startTime, error: err.message },
      };
    }
  }

  async discoverTools(_context: ConnectorConnectionContext): Promise<DiscoveredTool[]> {
    return [
      {
        name: 'search',
        displayName: 'Search Notion',
        description: 'Searches all Notion pages, databases, and documents shared with this integration.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query string to look for titles or text content',
            },
            filter: {
              type: 'object',
              description: 'Optional filter by object type (e.g. { value: "page", property: "object" })',
            },
            page_size: {
              type: 'number',
              description: 'Number of results to return (max 100, default 10)',
              default: 10,
            },
          },
        },
        requiresApproval: false,
        rateLimitPerMin: 60,
      },
      {
        name: 'get_page',
        displayName: 'Get Notion Page',
        description: 'Retrieve properties and metadata of a specific Notion page by page ID.',
        inputSchema: {
          type: 'object',
          required: ['page_id'],
          properties: {
            page_id: {
              type: 'string',
              description: 'The UUID of the Notion page to retrieve',
            },
          },
        },
        requiresApproval: false,
        rateLimitPerMin: 60,
      },
      {
        name: 'query_database',
        displayName: 'Query Notion Database',
        description: 'Queries entries/records from a Notion database with optional filtering and sorting.',
        inputSchema: {
          type: 'object',
          required: ['database_id'],
          properties: {
            database_id: {
              type: 'string',
              description: 'The UUID of the Notion database to query',
            },
            filter: {
              type: 'object',
              description: 'Compound or property filter object',
            },
            page_size: {
              type: 'number',
              description: 'Maximum results to return (default 25)',
              default: 25,
            },
          },
        },
        requiresApproval: false,
        rateLimitPerMin: 60,
      },
      {
        name: 'create_page',
        displayName: 'Create Notion Page',
        description: 'Creates a new page in a Notion database or as a child of an existing page.',
        inputSchema: {
          type: 'object',
          required: ['parent', 'properties'],
          properties: {
            parent: {
              type: 'object',
              description: 'Parent specifier, e.g. { "database_id": "..." } or { "page_id": "..." }',
            },
            properties: {
              type: 'object',
              description: 'Property values for the new page matching the database schema',
            },
            children: {
              type: 'array',
              description: 'Optional content blocks to place inside the new page',
            },
          },
        },
        requiresApproval: true,
        rateLimitPerMin: 30,
      },
    ];
  }

  async executeTool(
    toolName: string,
    params: Record<string, any>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const creds = await this.resolveCredentials(context);
    const token = this.getToken(creds);
    const headers = this.getHeaders(token);

    if (process.env.NODE_ENV === 'test' && token.includes('mock')) {
      return {
        success: true,
        data: { tool: toolName, mocked: true, params },
        durationMs: Date.now() - startTime,
      };
    }

    try {
      if (toolName === 'search') {
        const body: Record<string, any> = {};
        if (params.query) body.query = params.query;
        if (params.filter) body.filter = params.filter;
        if (params.page_size) body.page_size = params.page_size;

        const res = await fetch(`${this.NOTION_API_URL}/search`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`Notion search failed (${res.status}): ${await res.text()}`);
        const data = await res.json();
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      if (toolName === 'get_page') {
        const pageId = params.page_id.replace(/-/g, '');
        const res = await fetch(`${this.NOTION_API_URL}/pages/${pageId}`, {
          method: 'GET',
          headers,
        });
        if (!res.ok) throw new Error(`Notion get_page failed (${res.status}): ${await res.text()}`);
        const data = await res.json();
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      if (toolName === 'query_database') {
        const dbId = params.database_id.replace(/-/g, '');
        const body: Record<string, any> = {};
        if (params.filter) body.filter = params.filter;
        if (params.page_size) body.page_size = params.page_size;

        const res = await fetch(`${this.NOTION_API_URL}/databases/${dbId}/query`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`Notion query_database failed (${res.status}): ${await res.text()}`);
        const data = await res.json();
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      if (toolName === 'create_page') {
        const res = await fetch(`${this.NOTION_API_URL}/pages`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            parent: params.parent,
            properties: params.properties,
            children: params.children,
          }),
        });
        if (!res.ok) throw new Error(`Notion create_page failed (${res.status}): ${await res.text()}`);
        const data = await res.json();
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      throw new Error(`Unsupported Notion tool '${toolName}'`);
    } catch (err: any) {
      logger.error(`[NotionNativeAdapter] Tool execution error for '${toolName}':`, err);
      return {
        success: false,
        error: err.message,
        durationMs: Date.now() - startTime,
      };
    }
  }
}

export const notionNativeAdapter = new NotionNativeAdapter();
export default notionNativeAdapter;
