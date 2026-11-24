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

interface ScopedToolDefinition {
  tool: DiscoveredTool;
  anyOfScopes: string[];
}

const CORE_GMAIL_TOOL_NAMES = new Set(['list_messages', 'get_message', 'send_email']);

const GOOGLE_WORKSPACE_TOOLS: ScopedToolDefinition[] = [
  {
    anyOfScopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://mail.google.com/',
    ],
    tool: {
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
  },
  {
    anyOfScopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://mail.google.com/',
    ],
    tool: {
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
  },
  {
    anyOfScopes: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://mail.google.com/',
    ],
    tool: {
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
  },
  {
    anyOfScopes: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events.readonly',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar',
    ],
    tool: {
      name: 'list_calendar_events',
      displayName: 'List Google Calendar Events',
      description: 'Lists upcoming or filtered events from a Google Calendar.',
      inputSchema: {
        type: 'object',
        properties: {
          calendarId: {
            type: 'string',
            description: 'Calendar ID (defaults to "primary")',
            default: 'primary',
          },
          timeMin: {
            type: 'string',
            description: 'Lower bound (RFC3339 timestamp, e.g. "2026-01-01T00:00:00Z")',
          },
          timeMax: {
            type: 'string',
            description: 'Upper bound (RFC3339 timestamp)',
          },
          q: {
            type: 'string',
            description: 'Free-text search query',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of events to return (default 10)',
            default: 10,
          },
        },
      },
      requiresApproval: false,
      rateLimitPerMin: 60,
    },
  },
  {
    anyOfScopes: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar',
    ],
    tool: {
      name: 'create_calendar_event',
      displayName: 'Create Google Calendar Event',
      description: 'Creates a new event in a Google Calendar.',
      inputSchema: {
        type: 'object',
        required: ['summary', 'start', 'end'],
        properties: {
          calendarId: {
            type: 'string',
            description: 'Calendar ID (defaults to "primary")',
            default: 'primary',
          },
          summary: {
            type: 'string',
            description: 'Event title',
          },
          start: {
            type: 'string',
            description: 'Start time in RFC3339 format (e.g. "2026-01-15T10:00:00Z")',
          },
          end: {
            type: 'string',
            description: 'End time in RFC3339 format (e.g. "2026-01-15T11:00:00Z")',
          },
          description: {
            type: 'string',
            description: 'Optional event description',
          },
          location: {
            type: 'string',
            description: 'Optional event location',
          },
          attendees: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of attendee email addresses',
          },
        },
      },
      requiresApproval: true,
      rateLimitPerMin: 30,
    },
  },
  {
    anyOfScopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive',
    ],
    tool: {
      name: 'list_drive_files',
      displayName: 'List Google Drive Files',
      description: 'Lists or searches files and folders in Google Drive.',
      inputSchema: {
        type: 'object',
        properties: {
          q: {
            type: 'string',
            description: 'Drive search query (e.g. "name contains \'Report\' and trashed = false")',
          },
          pageSize: {
            type: 'number',
            description: 'Maximum number of files to return (default 20)',
            default: 20,
          },
        },
      },
      requiresApproval: false,
      rateLimitPerMin: 60,
    },
  },
  {
    anyOfScopes: [
      'https://www.googleapis.com/auth/documents.readonly',
      'https://www.googleapis.com/auth/documents',
    ],
    tool: {
      name: 'get_google_doc',
      displayName: 'Get Google Doc',
      description: 'Retrieves the title and content structure of a Google Docs document by ID.',
      inputSchema: {
        type: 'object',
        required: ['documentId'],
        properties: {
          documentId: {
            type: 'string',
            description: 'The ID of the Google Doc to retrieve',
          },
        },
      },
      requiresApproval: false,
      rateLimitPerMin: 60,
    },
  },
];

export class GmailNativeAdapter extends BaseNativeAdapter {
  readonly connectorType = 'NATIVE' as const;
  readonly connectorKey = 'gmail';
  private readonly GMAIL_API_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';
  private readonly CALENDAR_API_URL = 'https://www.googleapis.com/calendar/v3';
  private readonly DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';
  private readonly DOCS_API_URL = 'https://docs.googleapis.com/v1';

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

  private async resolveGrantedScopes(context: ConnectorConnectionContext): Promise<string[]> {
    const creds = await this.resolveCredentials(context);
    const rawScopes = creds.scopes ?? context.config?.scopes;

    if (Array.isArray(rawScopes) && rawScopes.length > 0) {
      return rawScopes.filter((s): s is string => typeof s === 'string' && s.length > 0);
    }
    if (typeof rawScopes === 'string' && rawScopes.trim().length > 0) {
      return rawScopes.trim().split(/\s+/);
    }

    const token = this.getToken(creds);
    if (!token || (process.env.NODE_ENV === 'test' && token.includes('mock'))) {
      return [];
    }

    try {
      const res = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`
      );
      if (!res.ok) return [];
      const info = (await res.json()) as { scope?: string };
      return info.scope ? info.scope.trim().split(/\s+/) : [];
    } catch (err: any) {
      logger.warn(`[GmailNativeAdapter] Failed to resolve tokeninfo scopes: ${err.message}`);
      return [];
    }
  }

  async discoverTools(context: ConnectorConnectionContext): Promise<DiscoveredTool[]> {
    const grantedScopes = await this.resolveGrantedScopes(context);

    // Fallback for legacy/unscoped bearer tokens or mock test contexts without scope metadata
    if (grantedScopes.length === 0) {
      return GOOGLE_WORKSPACE_TOOLS
        .filter((entry) => CORE_GMAIL_TOOL_NAMES.has(entry.tool.name))
        .map((entry) => entry.tool);
    }

    const scopeSet = new Set(grantedScopes);
    return GOOGLE_WORKSPACE_TOOLS
      .filter((entry) => entry.anyOfScopes.some((scope) => scopeSet.has(scope)))
      .map((entry) => entry.tool);
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

      if (toolName === 'list_calendar_events') {
        const calendarId = encodeURIComponent(params.calendarId || 'primary');
        const queryParams = new URLSearchParams({ singleEvents: 'true' });
        if (params.timeMin) queryParams.set('timeMin', params.timeMin);
        if (params.timeMax) queryParams.set('timeMax', params.timeMax);
        if (params.q) queryParams.set('q', params.q);
        queryParams.set('maxResults', String(params.maxResults || 10));

        const res = await fetch(`${this.CALENDAR_API_URL}/calendars/${calendarId}/events?${queryParams.toString()}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });
        if (!res.ok) throw new Error(`Calendar list_calendar_events failed (${res.status}): ${await res.text()}`);
        const data = await res.json();
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      if (toolName === 'create_calendar_event') {
        const calendarId = encodeURIComponent(params.calendarId || 'primary');
        const body: Record<string, any> = {
          summary: params.summary,
          start: { dateTime: params.start },
          end: { dateTime: params.end },
        };
        if (params.description) body.description = params.description;
        if (params.location) body.location = params.location;
        if (Array.isArray(params.attendees)) {
          body.attendees = params.attendees.map((email: string) => ({ email }));
        }

        const res = await fetch(`${this.CALENDAR_API_URL}/calendars/${calendarId}/events`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`Calendar create_calendar_event failed (${res.status}): ${await res.text()}`);
        const data = await res.json();
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      if (toolName === 'list_drive_files') {
        const queryParams = new URLSearchParams({
          pageSize: String(params.pageSize || 20),
          fields: 'files(id, name, mimeType, modifiedTime, webViewLink, size)',
        });
        if (params.q) queryParams.set('q', params.q);

        const res = await fetch(`${this.DRIVE_API_URL}/files?${queryParams.toString()}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });
        if (!res.ok) throw new Error(`Drive list_drive_files failed (${res.status}): ${await res.text()}`);
        const data = await res.json();
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      if (toolName === 'get_google_doc') {
        const docId = encodeURIComponent(params.documentId);
        const res = await fetch(`${this.DOCS_API_URL}/documents/${docId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });
        if (!res.ok) throw new Error(`Docs get_google_doc failed (${res.status}): ${await res.text()}`);
        const data = await res.json();
        return { success: true, data, durationMs: Date.now() - startTime };
      }

      throw new Error(`Unsupported Google Workspace native tool '${toolName}'`);
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
