import { ConnectorType, ConnectionAuthType } from '@prisma/client';
import prisma from '../../lib/prisma';
import logger from '../../lib/logger';

export interface SystemConnectorSeed {
  key: string;
  name: string;
  description: string;
  type: ConnectorType;
  supportedAuth: ConnectionAuthType[];
  iconUrl?: string;
  docUrl?: string;
  defaultConfig?: Record<string, any>;
}

export const SYSTEM_CONNECTOR_SEEDS: SystemConnectorSeed[] = [
  {
    key: 'gmail',
    name: 'Gmail',
    description: 'Read, search, draft, and organize emails via Google Workspace Gmail MCP Server',
    type: 'MCP',
    supportedAuth: ['OAUTH2_AUTHORIZATION_CODE', 'BEARER_TOKEN'],
    iconUrl: 'https://assets.matrix.ai/connectors/gmail.svg',
    docUrl: 'https://developers.google.com/gmail/api',
    defaultConfig: {
      serverUrl: 'https://gmailmcp.googleapis.com/mcp/v1',
      transport: 'STREAMABLE_HTTP',
      isDeveloperPreview: true,
      defaultScopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.send',
      ],
    },
  },
  {
    key: 'google-calendar',
    name: 'Google Calendar',
    description: 'Inspect schedules, query availability, and create calendar events via Google Calendar MCP Server',
    type: 'MCP',
    supportedAuth: ['OAUTH2_AUTHORIZATION_CODE', 'BEARER_TOKEN'],
    iconUrl: 'https://assets.matrix.ai/connectors/google-calendar.svg',
    docUrl: 'https://developers.google.com/calendar',
    defaultConfig: {
      serverUrl: 'https://calendarmcp.googleapis.com/mcp/v1',
      transport: 'STREAMABLE_HTTP',
      isDeveloperPreview: true,
      defaultScopes: [
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/calendar.events',
      ],
    },
  },
  {
    key: 'google-drive',
    name: 'Google Drive',
    description: 'Search files, inspect documents, and read metadata via Google Drive MCP Server',
    type: 'MCP',
    supportedAuth: ['OAUTH2_AUTHORIZATION_CODE', 'BEARER_TOKEN'],
    iconUrl: 'https://assets.matrix.ai/connectors/google-drive.svg',
    docUrl: 'https://developers.google.com/drive',
    defaultConfig: {
      serverUrl: 'https://drivemcp.googleapis.com/mcp/v1',
      transport: 'STREAMABLE_HTTP',
      isDeveloperPreview: true,
      defaultScopes: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.file',
      ],
    },
  },
  {
    key: 'google-docs',
    name: 'Google Docs',
    description: 'Read document context, search text, and insert content via Google Docs MCP Server',
    type: 'MCP',
    supportedAuth: ['OAUTH2_AUTHORIZATION_CODE', 'BEARER_TOKEN'],
    iconUrl: 'https://assets.matrix.ai/connectors/google-docs.svg',
    docUrl: 'https://developers.google.com/docs',
    defaultConfig: {
      serverUrl: 'https://docsmcp.googleapis.com/mcp/v1',
      transport: 'STREAMABLE_HTTP',
      isDeveloperPreview: true,
      defaultScopes: [
        'https://www.googleapis.com/auth/documents.readonly',
        'https://www.googleapis.com/auth/documents',
      ],
    },
  },
  {
    key: 'slack',
    name: 'Slack',
    description: 'Search workspace history, read threads, and post messages via Slack Remote MCP Server',
    type: 'MCP',
    supportedAuth: ['OAUTH2_AUTHORIZATION_CODE', 'BEARER_TOKEN'],
    iconUrl: 'https://assets.matrix.ai/connectors/slack.svg',
    docUrl: 'https://api.slack.com',
    defaultConfig: {
      serverUrl: 'https://mcp.slack.com/mcp',
      transport: 'STREAMABLE_HTTP',
      defaultScopes: ['chat:write', 'channels:read', 'channels:history', 'users:read', 'search:read'],
    },
  },
  {
    key: 'github',
    name: 'GitHub',
    description: 'Manage repositories, create pull requests, read issues, and query code via GitHub API',
    type: 'NATIVE',
    supportedAuth: ['OAUTH2_AUTHORIZATION_CODE', 'BEARER_TOKEN', 'API_KEY'],
    iconUrl: 'https://assets.matrix.ai/connectors/github.svg',
    docUrl: 'https://docs.github.com/en/rest',
    defaultConfig: {
      defaultScopes: ['repo', 'read:user', 'read:org'],
    },
  },
  {
    key: 'notion',
    name: 'Notion',
    description: 'Query pages, databases, and blocks to synchronize organizational knowledge',
    type: 'NATIVE',
    supportedAuth: ['OAUTH2_AUTHORIZATION_CODE', 'BEARER_TOKEN'],
    iconUrl: 'https://assets.matrix.ai/connectors/notion.svg',
    docUrl: 'https://developers.notion.com',
  },
  {
    key: 'jira',
    name: 'Atlassian Jira',
    description: 'Search Jira issues, create tickets, and update issue sprint statuses',
    type: 'NATIVE',
    supportedAuth: ['OAUTH2_AUTHORIZATION_CODE', 'BASIC_AUTH', 'BEARER_TOKEN'],
    iconUrl: 'https://assets.matrix.ai/connectors/jira.svg',
    docUrl: 'https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/',
  },
  {
    key: 'mcp-server',
    name: 'Model Context Protocol (MCP) Server',
    description: 'Connect any remote Model Context Protocol server over Streamable HTTP transport',
    type: 'MCP',
    supportedAuth: ['NONE', 'API_KEY', 'BEARER_TOKEN', 'CUSTOM_HEADERS'],
    iconUrl: 'https://assets.matrix.ai/connectors/mcp.svg',
    docUrl: 'https://modelcontextprotocol.io',
    defaultConfig: {
      transport: 'STREAMABLE_HTTP',
      timeoutMs: 15000,
    },
  },
  {
    key: 'custom-rest',
    name: 'Custom REST API',
    description: 'Integrate arbitrary REST endpoints with custom headers, parameter mapping, and schema validation',
    type: 'CUSTOM_REST',
    supportedAuth: ['NONE', 'API_KEY', 'BEARER_TOKEN', 'BASIC_AUTH', 'CUSTOM_HEADERS'],
    iconUrl: 'https://assets.matrix.ai/connectors/rest.svg',
    defaultConfig: {
      timeoutMs: 15000,
    },
  },
];

export class ConnectorRegistry {
  private inMemorySeeds: Map<string, SystemConnectorSeed> = new Map();
  private isInitialized = false;

  constructor() {
    for (const seed of SYSTEM_CONNECTOR_SEEDS) {
      this.inMemorySeeds.set(seed.key, seed);
    }
  }

  getSeeds(): SystemConnectorSeed[] {
    return Array.from(this.inMemorySeeds.values());
  }

  getSeedByKey(key: string): SystemConnectorSeed | undefined {
    return this.inMemorySeeds.get(key);
  }

  /**
   * Idempotently synchronizes system connector definitions into PostgreSQL.
   */
  async syncSystemDefinitions(): Promise<void> {
    if (this.isInitialized) return;

    try {
      for (const seed of SYSTEM_CONNECTOR_SEEDS) {
        await prisma.connectorDefinition.upsert({
          where: { key: seed.key },
          update: {
            name: seed.name,
            description: seed.description,
            type: seed.type,
            supportedAuth: seed.supportedAuth,
            iconUrl: seed.iconUrl,
            docUrl: seed.docUrl,
            defaultConfig: seed.defaultConfig ?? undefined,
          },
          create: {
            key: seed.key,
            name: seed.name,
            description: seed.description,
            type: seed.type,
            supportedAuth: seed.supportedAuth,
            iconUrl: seed.iconUrl,
            docUrl: seed.docUrl,
            isSystem: true,
            defaultConfig: seed.defaultConfig ?? undefined,
          },
        });
      }
      this.isInitialized = true;
      logger.info(`[ConnectorRegistry] Synchronized ${SYSTEM_CONNECTOR_SEEDS.length} system connector definitions.`);
    } catch (err: any) {
      logger.warn(`[ConnectorRegistry] Database sync skipped or failed (${err.message}). Using in-memory catalog fallback.`);
    }
  }
}

export const connectorRegistry = new ConnectorRegistry();
export default connectorRegistry;
