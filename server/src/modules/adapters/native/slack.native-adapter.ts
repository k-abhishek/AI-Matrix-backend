import { BaseNativeAdapter } from './base-native.adapter';
import {
  ConnectorConnectionContext,
  ConnectionHealthResult,
  DiscoveredTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../base.adapter';
import logger from '../../../lib/logger';

export class SlackNativeAdapter extends BaseNativeAdapter {
  readonly connectorType = 'NATIVE' as const;
  readonly connectorKey = 'slack';
  private readonly SLACK_API_URL = 'https://slack.com/api';

  private getToken(creds: Record<string, any>): string {
    return creds.accessToken || creds.apiKey || creds.token || '';
  }

  private getHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
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
        message: 'No Slack Bot User Token (xoxb-...) or User Token provided.',
        testedAt: new Date(),
      };
    }

    if (process.env.NODE_ENV === 'test' && token.includes('mock')) {
      return {
        status: 'CONNECTED',
        isHealthy: true,
        message: 'Slack API connection verified (mock mode)',
        testedAt: new Date(),
        details: { latencyMs: 20 },
      };
    }

    try {
      const res = await fetch(`${this.SLACK_API_URL}/auth.test`, {
        method: 'POST',
        headers: this.getHeaders(token),
      });

      const latencyMs = Date.now() - startTime;
      const data = await res.json() as any;

      if (!res.ok || !data.ok) {
        return {
          status: 'ERROR',
          isHealthy: false,
          message: `Slack authentication failed: ${data.error || res.statusText}`,
          testedAt: new Date(),
          details: { latencyMs, error: data.error },
        };
      }

      return {
        status: 'CONNECTED',
        isHealthy: true,
        message: `Successfully connected to Slack team '${data.team}' as user '${data.user}'`,
        testedAt: new Date(),
        details: { latencyMs, team: data.team, user: data.user, teamId: data.team_id, userId: data.user_id },
      };
    } catch (err: any) {
      return {
        status: 'ERROR',
        isHealthy: false,
        message: `Slack connection error: ${err.message}`,
        testedAt: new Date(),
        details: { latencyMs: Date.now() - startTime, error: err.message },
      };
    }
  }

  async discoverTools(_context: ConnectorConnectionContext): Promise<DiscoveredTool[]> {
    return [
      {
        name: 'post_message',
        displayName: 'Post Slack Message',
        description: 'Sends a message to a Slack channel or direct message conversation.',
        inputSchema: {
          type: 'object',
          required: ['channel', 'text'],
          properties: {
            channel: {
              type: 'string',
              description: 'Channel ID (e.g. C1234567890) or channel name (e.g. #general)',
            },
            text: {
              type: 'string',
              description: 'The message text content to post',
            },
          },
        },
        requiresApproval: true,
        rateLimitPerMin: 30,
      },
      {
        name: 'list_channels',
        displayName: 'List Slack Channels',
        description: 'Lists public and private channels in the connected Slack workspace.',
        inputSchema: {
          type: 'object',
          properties: {
            types: {
              type: 'string',
              description: 'Types of channels to include (comma-separated, default "public_channel,private_channel")',
              default: 'public_channel,private_channel',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of channels to return (default 50)',
              default: 50,
            },
          },
        },
        requiresApproval: false,
        rateLimitPerMin: 60,
      },
      {
        name: 'get_channel_history',
        displayName: 'Get Channel History',
        description: 'Fetches recent conversation history and messages from a specific Slack channel.',
        inputSchema: {
          type: 'object',
          required: ['channel'],
          properties: {
            channel: {
              type: 'string',
              description: 'Channel ID to retrieve messages from',
            },
            limit: {
              type: 'number',
              description: 'Number of recent messages to return (default 20, max 100)',
              default: 20,
            },
          },
        },
        requiresApproval: false,
        rateLimitPerMin: 60,
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
      if (toolName === 'post_message') {
        const res = await fetch(`${this.SLACK_API_URL}/chat.postMessage`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            channel: params.channel,
            text: params.text,
          }),
        });
        const data = await res.json() as any;
        if (!data.ok) throw new Error(`Slack post_message failed: ${data.error}`);
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      if (toolName === 'list_channels') {
        const types = params.types || 'public_channel,private_channel';
        const limit = params.limit || 50;
        const res = await fetch(`${this.SLACK_API_URL}/conversations.list?types=${encodeURIComponent(types)}&limit=${limit}`, {
          method: 'GET',
          headers,
        });
        const data = await res.json() as any;
        if (!data.ok) throw new Error(`Slack list_channels failed: ${data.error}`);
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      if (toolName === 'get_channel_history') {
        const channel = params.channel;
        const limit = params.limit || 20;
        const res = await fetch(`${this.SLACK_API_URL}/conversations.history?channel=${encodeURIComponent(channel)}&limit=${limit}`, {
          method: 'GET',
          headers,
        });
        const data = await res.json() as any;
        if (!data.ok) throw new Error(`Slack get_channel_history failed: ${data.error}`);
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      throw new Error(`Unsupported Slack tool '${toolName}'`);
    } catch (err: any) {
      logger.error(`[SlackNativeAdapter] Tool execution error for '${toolName}':`, err);
      return {
        success: false,
        error: err.message,
        durationMs: Date.now() - startTime,
      };
    }
  }
}

export const slackNativeAdapter = new SlackNativeAdapter();
export default slackNativeAdapter;
