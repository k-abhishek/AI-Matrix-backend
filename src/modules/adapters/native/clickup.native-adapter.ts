import { BaseNativeAdapter } from './base-native.adapter';
import {
  ConnectorConnectionContext,
  ConnectionHealthResult,
  DiscoveredTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../base.adapter';
import logger from '../../../lib/logger';

export class ClickUpNativeAdapter extends BaseNativeAdapter {
  readonly connectorType = 'NATIVE' as const;
  readonly connectorKey = 'clickup';
  private readonly CLICKUP_API_URL = 'https://api.clickup.com/api/v2';

  private getToken(creds: Record<string, any>): string {
    return creds.apiKey || creds.accessToken || creds.token || '';
  }

  private getHeaders(token: string): Record<string, string> {
    return {
      Authorization: token,
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
        message: 'No ClickUp Personal API Token (pk_...) provided.',
        testedAt: new Date(),
      };
    }

    if (process.env.NODE_ENV === 'test' && token.includes('mock')) {
      return {
        status: 'CONNECTED',
        isHealthy: true,
        message: 'ClickUp API connection verified (mock mode)',
        testedAt: new Date(),
        details: { latencyMs: 22 },
      };
    }

    try {
      const res = await fetch(`${this.CLICKUP_API_URL}/user`, {
        method: 'GET',
        headers: this.getHeaders(token),
      });

      const latencyMs = Date.now() - startTime;
      if (!res.ok) {
        const errText = await res.text();
        return {
          status: 'ERROR',
          isHealthy: false,
          message: `ClickUp authentication failed (${res.status}): ${errText}`,
          testedAt: new Date(),
          details: { latencyMs, status: res.status },
        };
      }

      const body = await res.json() as any;
      const user = body.user || {};
      return {
        status: 'CONNECTED',
        isHealthy: true,
        message: `Successfully connected to ClickUp as ${user.username || user.email || 'user'}`,
        testedAt: new Date(),
        details: { latencyMs, userId: user.id, username: user.username },
      };
    } catch (err: any) {
      return {
        status: 'ERROR',
        isHealthy: false,
        message: `ClickUp connection error: ${err.message}`,
        testedAt: new Date(),
        details: { latencyMs: Date.now() - startTime, error: err.message },
      };
    }
  }

  async discoverTools(_context: ConnectorConnectionContext): Promise<DiscoveredTool[]> {
    return [
      {
        name: 'get_teams',
        displayName: 'Get ClickUp Workspaces',
        description: 'Retrieves all authorized workspaces (teams) for the authenticated ClickUp account.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        requiresApproval: false,
        rateLimitPerMin: 60,
      },
      {
        name: 'get_spaces',
        displayName: 'Get ClickUp Spaces',
        description: 'Lists all spaces contained within a specific ClickUp workspace/team.',
        inputSchema: {
          type: 'object',
          required: ['team_id'],
          properties: {
            team_id: {
              type: 'string',
              description: 'The ClickUp workspace/team ID',
            },
          },
        },
        requiresApproval: false,
        rateLimitPerMin: 60,
      },
      {
        name: 'get_tasks',
        displayName: 'Get ClickUp Tasks',
        description: 'Queries tasks from a specific ClickUp list with filtering options.',
        inputSchema: {
          type: 'object',
          required: ['list_id'],
          properties: {
            list_id: {
              type: 'string',
              description: 'The ID of the ClickUp list to fetch tasks from',
            },
            archived: {
              type: 'boolean',
              description: 'Whether to include archived tasks',
              default: false,
            },
            page: {
              type: 'number',
              description: 'Page index for pagination (default 0)',
              default: 0,
            },
          },
        },
        requiresApproval: false,
        rateLimitPerMin: 60,
      },
      {
        name: 'create_task',
        displayName: 'Create ClickUp Task',
        description: 'Creates a new task within a ClickUp list with a title, description, priority, and status.',
        inputSchema: {
          type: 'object',
          required: ['list_id', 'name'],
          properties: {
            list_id: {
              type: 'string',
              description: 'Target list ID where the task should be created',
            },
            name: {
              type: 'string',
              description: 'Task title / name',
            },
            description: {
              type: 'string',
              description: 'Detailed description of the task',
            },
            priority: {
              type: 'number',
              description: 'Priority level (1: Urgent, 2: High, 3: Normal, 4: Low)',
            },
            status: {
              type: 'string',
              description: 'Initial task status (e.g. "to do", "in progress")',
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
      if (toolName === 'get_teams') {
        const res = await fetch(`${this.CLICKUP_API_URL}/team`, { headers });
        if (!res.ok) throw new Error(`ClickUp get_teams failed (${res.status}): ${await res.text()}`);
        const data = await res.json();
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      if (toolName === 'get_spaces') {
        const teamId = params.team_id;
        const res = await fetch(`${this.CLICKUP_API_URL}/team/${teamId}/space`, { headers });
        if (!res.ok) throw new Error(`ClickUp get_spaces failed (${res.status}): ${await res.text()}`);
        const data = await res.json();
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      if (toolName === 'get_tasks') {
        const listId = params.list_id;
        const queryParams = new URLSearchParams();
        if (params.archived !== undefined) queryParams.set('archived', String(params.archived));
        if (params.page !== undefined) queryParams.set('page', String(params.page));

        const res = await fetch(`${this.CLICKUP_API_URL}/list/${listId}/task?${queryParams.toString()}`, { headers });
        if (!res.ok) throw new Error(`ClickUp get_tasks failed (${res.status}): ${await res.text()}`);
        const data = await res.json();
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      if (toolName === 'create_task') {
        const listId = params.list_id;
        const body: Record<string, any> = {
          name: params.name,
        };
        if (params.description) body.description = params.description;
        if (params.priority !== undefined) body.priority = params.priority;
        if (params.status) body.status = params.status;

        const res = await fetch(`${this.CLICKUP_API_URL}/list/${listId}/task`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`ClickUp create_task failed (${res.status}): ${await res.text()}`);
        const data = await res.json();
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      throw new Error(`Unsupported ClickUp tool '${toolName}'`);
    } catch (err: any) {
      logger.error(`[ClickUpNativeAdapter] Tool execution error for '${toolName}':`, err);
      return {
        success: false,
        error: err.message,
        durationMs: Date.now() - startTime,
      };
    }
  }
}

export const clickupNativeAdapter = new ClickUpNativeAdapter();
export default clickupNativeAdapter;
