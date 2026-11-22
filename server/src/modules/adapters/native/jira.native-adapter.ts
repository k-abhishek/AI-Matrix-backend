import { BaseNativeAdapter } from './base-native.adapter';
import {
  ConnectorConnectionContext,
  ConnectionHealthResult,
  DiscoveredTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../base.adapter';
import logger from '../../../lib/logger';

export class JiraNativeAdapter extends BaseNativeAdapter {
  readonly connectorType = 'NATIVE' as const;
  readonly connectorKey = 'jira';

  private getAuthHeader(creds: Record<string, any>): string {
    if (creds.username && creds.password) {
      const basic = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
      return `Basic ${basic}`;
    }
    const token = creds.accessToken || creds.apiKey || creds.token;
    if (token) {
      if (token.startsWith('Basic ')) return token;
      return `Bearer ${token}`;
    }
    return '';
  }

  private resolveBaseUrl(context: ConnectorConnectionContext | ToolExecutionContext): string {
    const raw = context.baseUrl || context.config?.baseUrl || 'https://api.atlassian.com';
    return raw.replace(/\/+$/, '');
  }

  async testConnection(context: ConnectorConnectionContext): Promise<ConnectionHealthResult> {
    const startTime = Date.now();
    const creds = await this.resolveCredentials(context);
    const authHeader = this.getAuthHeader(creds);

    if (!authHeader) {
      return {
        status: 'DISCONNECTED',
        isHealthy: false,
        message: 'No credentials configured. Jira requires an email and API token (Basic Auth) or Personal Token.',
        testedAt: new Date(),
      };
    }

    if (process.env.NODE_ENV === 'test' && (creds.username?.includes('mock') || creds.accessToken?.includes('mock'))) {
      return {
        status: 'CONNECTED',
        isHealthy: true,
        message: 'Jira API connection verified (mock mode)',
        testedAt: new Date(),
        details: { latencyMs: 25 },
      };
    }

    try {
      const baseUrl = this.resolveBaseUrl(context);
      const res = await fetch(`${baseUrl}/rest/api/3/myself`, {
        method: 'GET',
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
        },
      });

      const latencyMs = Date.now() - startTime;
      if (!res.ok) {
        const errText = await res.text();
        return {
          status: 'ERROR',
          isHealthy: false,
          message: `Jira authentication failed (${res.status}): ${errText}`,
          testedAt: new Date(),
          details: { latencyMs, status: res.status },
        };
      }

      const user = await res.json() as any;
      return {
        status: 'CONNECTED',
        isHealthy: true,
        message: `Successfully connected to Jira as ${user.displayName || user.emailAddress || 'authenticated user'}`,
        testedAt: new Date(),
        details: { latencyMs, displayName: user.displayName, accountId: user.accountId },
      };
    } catch (err: any) {
      return {
        status: 'ERROR',
        isHealthy: false,
        message: `Jira connection error: ${err.message}`,
        testedAt: new Date(),
        details: { latencyMs: Date.now() - startTime, error: err.message },
      };
    }
  }

  async discoverTools(_context: ConnectorConnectionContext): Promise<DiscoveredTool[]> {
    return [
      {
        name: 'search_issues',
        displayName: 'Search Jira Issues',
        description: 'Search Jira issues using JQL (Jira Query Language). Returns issue summaries, keys, statuses, and assignees.',
        inputSchema: {
          type: 'object',
          required: ['jql'],
          properties: {
            jql: {
              type: 'string',
              description: 'JQL query string (e.g. "project = ENG AND status != Done ORDER BY created DESC")',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of issues to return (default 10, max 50)',
              default: 10,
            },
          },
        },
        requiresApproval: false,
        rateLimitPerMin: 60,
      },
      {
        name: 'get_issue',
        displayName: 'Get Jira Issue Details',
        description: 'Retrieve full details, description, comments, and field values for a specific Jira issue by key or ID.',
        inputSchema: {
          type: 'object',
          required: ['issueKey'],
          properties: {
            issueKey: {
              type: 'string',
              description: 'The Jira issue key or ID (e.g. "ENG-123")',
            },
          },
        },
        requiresApproval: false,
        rateLimitPerMin: 60,
      },
      {
        name: 'create_issue',
        displayName: 'Create Jira Issue',
        description: 'Creates a new ticket/issue in Jira with summary, project key, description, and issue type.',
        inputSchema: {
          type: 'object',
          required: ['projectKey', 'summary'],
          properties: {
            projectKey: {
              type: 'string',
              description: 'Project key under which to create the issue (e.g. "PROJ")',
            },
            summary: {
              type: 'string',
              description: 'Short headline or title of the issue',
            },
            description: {
              type: 'string',
              description: 'Detailed description of the issue or task',
            },
            issueType: {
              type: 'string',
              description: 'Type of issue (e.g. "Task", "Bug", "Story")',
              default: 'Task',
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
    const authHeader = this.getAuthHeader(creds);
    const baseUrl = this.resolveBaseUrl(context);

    if (process.env.NODE_ENV === 'test' && (creds.username?.includes('mock') || creds.accessToken?.includes('mock'))) {
      return {
        success: true,
        data: { tool: toolName, mocked: true, params },
        durationMs: Date.now() - startTime,
      };
    }

    try {
      if (toolName === 'search_issues') {
        const jql = params.jql || '';
        const maxResults = params.maxResults || 10;
        const res = await fetch(`${baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`, {
          headers: { Authorization: authHeader, Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`Jira search failed (${res.status}): ${await res.text()}`);
        const data = await res.json();
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      if (toolName === 'get_issue') {
        const issueKey = params.issueKey;
        const res = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
          headers: { Authorization: authHeader, Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`Jira get issue failed (${res.status}): ${await res.text()}`);
        const data = await res.json();
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      if (toolName === 'create_issue') {
        const body = {
          fields: {
            project: { key: params.projectKey },
            summary: params.summary,
            description: params.description ? {
              type: 'doc',
              version: 1,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: params.description }] }],
            } : undefined,
            issuetype: { name: params.issueType || 'Task' },
          },
        };

        const res = await fetch(`${baseUrl}/rest/api/3/issue`, {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`Jira create issue failed (${res.status}): ${await res.text()}`);
        const data = await res.json();
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      throw new Error(`Unsupported Jira tool '${toolName}'`);
    } catch (err: any) {
      logger.error(`[JiraNativeAdapter] Tool execution error for '${toolName}':`, err);
      return {
        success: false,
        error: err.message,
        durationMs: Date.now() - startTime,
      };
    }
  }
}

export const jiraNativeAdapter = new JiraNativeAdapter();
export default jiraNativeAdapter;
