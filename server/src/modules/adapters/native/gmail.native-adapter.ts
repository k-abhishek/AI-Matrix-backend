import { BaseNativeAdapter } from './base-native.adapter';
import {
  ConnectorConnectionContext,
  ConnectionHealthResult,
  DiscoveredTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../base.adapter';
import gmailSendFallbackAdapter from './fallback/gmail-send-fallback';
import logger from '../../../lib/logger';

export class GmailNativeAdapter extends BaseNativeAdapter {
  readonly connectorType = 'NATIVE' as const;
  readonly connectorKey = 'gmail';
  private readonly GMAIL_API_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';

  private getToken(creds: Record<string, any>): string {
    return creds.accessToken || creds.apiKey || creds.token || '';
  }

  async testConnection(context: ConnectorConnectionContext): Promise<ConnectionHealthResult> {
    const startTime = Date.now();
    const creds = await this.resolveCredentials(context);
    const token = this.getToken(creds);

    if (!token) {
      return {
        status: 'DISCONNECTED',
        isHealthy: false,
        message: 'No Gmail OAuth Access Token or Bearer Token found.',
        testedAt: new Date(),
      };
    }

    if (process.env.NODE_ENV === 'test' && token.includes('mock')) {
      return {
        status: 'CONNECTED',
        isHealthy: true,
        message: 'Gmail API connection verified (mock mode)',
        testedAt: new Date(),
        details: { latencyMs: 25 },
      };
    }

    try {
      const res = await fetch(`${this.GMAIL_API_URL}/profile`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      const latencyMs = Date.now() - startTime;
      if (!res.ok) {
        const errText = await res.text();
        return {
          status: 'ERROR',
          isHealthy: false,
          message: `Gmail profile check failed (${res.status}): ${errText}`,
          testedAt: new Date(),
          details: { latencyMs, status: res.status },
        };
      }

      const profile = await res.json() as any;
      return {
        status: 'CONNECTED',
        isHealthy: true,
        message: `Successfully connected to Gmail mailbox: ${profile.emailAddress}`,
        testedAt: new Date(),
        details: {
          latencyMs,
          emailAddress: profile.emailAddress,
          messagesTotal: profile.messagesTotal,
          threadsTotal: profile.threadsTotal,
        },
      };
    } catch (err: any) {
      return {
        status: 'ERROR',
        isHealthy: false,
        message: `Gmail connection error: ${err.message}`,
        testedAt: new Date(),
        details: { latencyMs: Date.now() - startTime, error: err.message },
      };
    }
  }

  async discoverTools(_context: ConnectorConnectionContext): Promise<DiscoveredTool[]> {
    return [
      {
        name: 'list_messages',
        displayName: 'List Gmail Messages',
        description: 'Lists or searches messages in the connected Gmail inbox using Gmail search filters.',
        inputSchema: {
          type: 'object',
          properties: {
            q: {
              type: 'string',
              description: 'Gmail query string (e.g. "from:boss@example.com is:unread", "label:INBOX")',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of messages to return (default 10, max 50)',
              default: 10,
            },
          },
        },
        requiresApproval: false,
        rateLimitPerMin: 60,
      },
      {
        name: 'get_message',
        displayName: 'Get Gmail Message',
        description: 'Retrieves the body, headers, and metadata of a specific email message by message ID.',
        inputSchema: {
          type: 'object',
          required: ['messageId'],
          properties: {
            messageId: {
              type: 'string',
              description: 'The unique ID of the Gmail message to retrieve',
            },
          },
        },
        requiresApproval: false,
        rateLimitPerMin: 60,
      },
      {
        name: 'send_email',
        displayName: 'Send Email via Gmail',
        description: 'Sends an email to one or more recipients via the standard Gmail REST API.',
        inputSchema: {
          type: 'object',
          required: ['to', 'subject', 'body'],
          properties: {
            to: {
              type: 'string',
              description: 'Recipient email address',
            },
            subject: {
              type: 'string',
              description: 'Email subject line',
            },
            body: {
              type: 'string',
              description: 'Plain text email content',
            },
            cc: {
              type: 'string',
              description: 'Optional CC email address',
            },
            bcc: {
              type: 'string',
              description: 'Optional BCC email address',
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

    if (toolName === 'send_email') {
      return gmailSendFallbackAdapter.sendEmail(context.connectionId, params as any, context.timeoutMs);
    }

    if (process.env.NODE_ENV === 'test' && token.includes('mock')) {
      return {
        success: true,
        data: { tool: toolName, mocked: true, params },
        durationMs: Date.now() - startTime,
      };
    }

    try {
      if (toolName === 'list_messages') {
        const queryParams = new URLSearchParams();
        if (params.q) queryParams.set('q', params.q);
        if (params.maxResults) queryParams.set('maxResults', String(params.maxResults));

        const res = await fetch(`${this.GMAIL_API_URL}/messages?${queryParams.toString()}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });
        if (!res.ok) throw new Error(`Gmail list_messages failed (${res.status}): ${await res.text()}`);
        const data = await res.json();
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      if (toolName === 'get_message') {
        const msgId = encodeURIComponent(params.messageId);
        const res = await fetch(`${this.GMAIL_API_URL}/messages/${msgId}?format=full`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });
        if (!res.ok) throw new Error(`Gmail get_message failed (${res.status}): ${await res.text()}`);
        const data = await res.json();
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      throw new Error(`Unsupported Gmail native tool '${toolName}'`);
    } catch (err: any) {
      logger.error(`[GmailNativeAdapter] Tool execution error for '${toolName}':`, err);
      return {
        success: false,
        error: err.message,
        durationMs: Date.now() - startTime,
      };
    }
  }
}

export const gmailNativeAdapter = new GmailNativeAdapter();
export default gmailNativeAdapter;
