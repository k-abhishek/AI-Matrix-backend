import { ConnectorType, ConnectionAuthType } from "@prisma/client";
import prisma from "../../lib/prisma";
import logger from "../../lib/logger";
import env from "../../config/env";
import { CatalogAuthField } from "./connector.types";
import oauthProviderRegistry from "../connections/oauth/oauth-provider.registry";

export interface SystemConnectorSeed {
  key: string;
  name: string;
  description: string;
  type: ConnectorType;
  supportedAuth: ConnectionAuthType[];
  recommendedAuth: ConnectionAuthType;
  requiresBaseUrl: boolean;
  baseUrlLabel?: string;
  baseUrlPlaceholder?: string;
  authFields: Record<string, CatalogAuthField[]>;
  iconKey: string;
  docUrl?: string;
  isAvailable: boolean;
  defaultConfig?: Record<string, any>;
}

export const STABLE_UUID_MAP: Record<string, string> = {
  "google-workspace": "a1000000-0000-4000-8000-000000000001",
  slack: "a1000000-0000-4000-8000-000000000005",
  github: "a1000000-0000-4000-8000-000000000006",
  notion: "a1000000-0000-4000-8000-000000000007",
  jira: "a1000000-0000-4000-8000-000000000008",
  clickup: "a1000000-0000-4000-8000-000000000009",
  "mcp-server": "a1000000-0000-4000-8000-000000000010",
  "custom-rest": "a1000000-0000-4000-8000-000000000011",
};

const COMMON_AUTH_FIELDS = {
  BEARER_TOKEN: [
    {
      name: "token",
      label: "Bearer Token / Personal Access Token",
      type: "password" as const,
      placeholder: "Bearer token string",
      required: true,
    },
  ],
  API_KEY: [
    {
      name: "apiKey",
      label: "API Key",
      type: "password" as const,
      placeholder: "API Key string",
      required: true,
    },
  ],
  OAUTH2: [] as CatalogAuthField[],
  NONE: [] as CatalogAuthField[],
  CUSTOM_HEADERS: [
    {
      name: "headers",
      label: "Custom HTTP Headers (JSON)",
      type: "text" as const,
      placeholder: '{"Authorization": "Bearer ...", "X-Custom-Auth": "..."}',
      helpText:
        "JSON key-value mapping of headers to attach to every outgoing request",
      required: true,
    },
  ],
};

export const SYSTEM_CONNECTOR_SEEDS: SystemConnectorSeed[] = [
  {
    key: "google-workspace",
    name: "Google Workspace",
    description:
      "Read, search, draft, and send emails via Gmail, coordinate calendar schedules, and access Google Drive files",
    type: "NATIVE",
    supportedAuth: ["BEARER_TOKEN", "OAUTH2_AUTHORIZATION_CODE"],
    recommendedAuth: "BEARER_TOKEN",
    requiresBaseUrl: false,
    iconKey: "google",
    docUrl: "https://developers.google.com/gmail/api",
    isAvailable: true,
    authFields: {
      BEARER_TOKEN: [
        {
          name: "token",
          label: "OAuth Access Token or Bearer Token",
          type: "password",
          placeholder: "ya29.a0...",
          helpText: "Google OAuth access token with Gmail API scopes",
          required: true,
        },
      ],
      OAUTH2_AUTHORIZATION_CODE: [],
    },
    defaultConfig: {
      defaultScopes:[
        // Identity
        "openid",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
      
        // Gmail
        "https://www.googleapis.com/auth/gmail.modify", // read, label, archive, drafts, send
      
        // Calendar
        "https://www.googleapis.com/auth/calendar.readonly", // list calendars
        "https://www.googleapis.com/auth/calendar.events",   // read/write events
      
        // Drive
        "https://www.googleapis.com/auth/drive", // full file access
      
        // Docs, Sheets, Slides (contents, not just files)
        "https://www.googleapis.com/auth/documents",
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/presentations",
      ],
    },
  },
  {
    key: "slack",
    name: "Slack",
    description:
      "Post messages, inspect channels, and read thread history via Slack API",
    type: "NATIVE",
    supportedAuth: ["OAUTH2_AUTHORIZATION_CODE"],
    recommendedAuth: "BEARER_TOKEN",
    requiresBaseUrl: false,
    iconKey: "slack",
    docUrl: "https://api.slack.com",
    isAvailable: true,
    authFields: {
      BEARER_TOKEN: [
        {
          name: "token",
          label: "Bot User OAuth Token",
          type: "password",
          placeholder: "xoxb-...",
          helpText: "Bot User OAuth Token starting with xoxb-",
          required: true,
        },
      ],
      OAUTH2_AUTHORIZATION_CODE: [],
    },
    defaultConfig: {
      defaultScopes: [
        "chat:write",
        "channels:read",
        "channels:history",
        "users:read",
      ],
    },
  },
  {
    key: "github",
    name: "GitHub",
    description:
      "Manage repositories, inspect issues, and create issue tickets via GitHub REST API",
    type: "NATIVE",
    supportedAuth: ["BEARER_TOKEN", "API_KEY", "OAUTH2_AUTHORIZATION_CODE"],
    recommendedAuth: "BEARER_TOKEN",
    requiresBaseUrl: false,
    iconKey: "github",
    docUrl: "https://docs.github.com/en/rest",
    isAvailable: true,
    authFields: {
      BEARER_TOKEN: [
        {
          name: "token",
          label: "GitHub Personal Access Token (PAT)",
          type: "password",
          placeholder: "ghp_...",
          helpText: "Personal Access Token with repo and read:user scopes",
          required: true,
        },
      ],
      API_KEY: [
        {
          name: "apiKey",
          label: "GitHub Personal Access Token (PAT)",
          type: "password",
          placeholder: "ghp_...",
          required: true,
        },
      ],
      OAUTH2_AUTHORIZATION_CODE: [],
    },
    defaultConfig: {
      defaultScopes: ["repo", "read:user", "user:email"],
    },
  },
  {
    key: "notion",
    name: "Notion",
    description:
      "Query pages, databases, and blocks to synchronize organizational knowledge",
    type: "NATIVE",
    supportedAuth: ["BEARER_TOKEN", "API_KEY", "OAUTH2_AUTHORIZATION_CODE"],
    recommendedAuth: "BEARER_TOKEN",
    requiresBaseUrl: false,
    iconKey: "notion",
    docUrl: "https://developers.notion.com",
    isAvailable: true,
    authFields: {
      BEARER_TOKEN: [
        {
          name: "token",
          label: "Internal Integration Secret",
          type: "password",
          placeholder: "secret_... or ntn_...",
          helpText: "Internal Integration Secret from Notion Developers portal",
          required: true,
        },
      ],
      API_KEY: [
        {
          name: "apiKey",
          label: "Internal Integration Secret",
          type: "password",
          placeholder: "secret_...",
          required: true,
        },
      ],
      OAUTH2_AUTHORIZATION_CODE: [],
    },
  },
  {
    key: "clickup",
    name: "ClickUp",
    description:
      "Manage tasks, workspaces, lists, and team productivity via ClickUp API",
    type: "NATIVE",
    supportedAuth: ["API_KEY", "BEARER_TOKEN", "OAUTH2_AUTHORIZATION_CODE"],
    recommendedAuth: "API_KEY",
    requiresBaseUrl: false,
    iconKey: "clickup",
    docUrl: "https://clickup.com/api",
    isAvailable: true,
    authFields: {
      API_KEY: [
        {
          name: "apiKey",
          label: "ClickUp Personal API Token",
          type: "password",
          placeholder: "pk_...",
          helpText: "Generated from ClickUp Settings > Apps > API Token",
          required: true,
        },
      ],
      BEARER_TOKEN: [
        {
          name: "token",
          label: "ClickUp API Token",
          type: "password",
          placeholder: "pk_...",
          required: true,
        },
      ],
      OAUTH2_AUTHORIZATION_CODE: [],
    },
  },
  {
    key: "mcp-server",
    name: "Model Context Protocol (MCP) Server",
    description:
      "Connect any remote Model Context Protocol server over Streamable HTTP transport",
    type: "MCP",
    supportedAuth: ["NONE", "API_KEY", "BEARER_TOKEN", "CUSTOM_HEADERS"],
    recommendedAuth: "NONE",
    requiresBaseUrl: true,
    baseUrlLabel: "MCP Server Endpoint",
    baseUrlPlaceholder: "https://mcp-server.example.com/mcp",
    iconKey: "mcp-server",
    docUrl: "https://modelcontextprotocol.io",
    isAvailable: true,
    authFields: {
      NONE: COMMON_AUTH_FIELDS.NONE,
      API_KEY: COMMON_AUTH_FIELDS.API_KEY,
      BEARER_TOKEN: COMMON_AUTH_FIELDS.BEARER_TOKEN,
      CUSTOM_HEADERS: COMMON_AUTH_FIELDS.CUSTOM_HEADERS,
    },
    defaultConfig: {
      transport: "STREAMABLE_HTTP",
      timeoutMs: 15000,
    },
  },
  {
    key: "custom-rest",
    name: "Custom REST API",
    description:
      "Integrate arbitrary REST endpoints with custom headers, parameter mapping, and schema validation",
    type: "CUSTOM_REST",
    supportedAuth: [
      "API_KEY",
      "BEARER_TOKEN",
      "BASIC_AUTH",
      "NONE",
      "CUSTOM_HEADERS",
    ],
    recommendedAuth: "API_KEY",
    requiresBaseUrl: true,
    baseUrlLabel: "API Base URL",
    baseUrlPlaceholder: "https://api.example.com/v1",
    iconKey: "custom-rest",
    isAvailable: true,
    authFields: {
      API_KEY: COMMON_AUTH_FIELDS.API_KEY,
      BEARER_TOKEN: COMMON_AUTH_FIELDS.BEARER_TOKEN,
      BASIC_AUTH: [
        {
          name: "username",
          label: "Username",
          type: "text",
          placeholder: "Username",
          required: true,
        },
        {
          name: "password",
          label: "Password",
          type: "password",
          placeholder: "Password",
          required: true,
        },
      ],
      NONE: COMMON_AUTH_FIELDS.NONE,
      CUSTOM_HEADERS: COMMON_AUTH_FIELDS.CUSTOM_HEADERS,
    },
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
    const k = key.toLowerCase();
    return (
      this.inMemorySeeds.get(k) ||
      (k === "gmail" ? this.inMemorySeeds.get("google-workspace") : undefined)
    );
  }

  getStableUuid(key: string): string {
    return (
      STABLE_UUID_MAP[key.toLowerCase()] ||
      "a1000000-0000-4000-8000-000000000099"
    );
  }

  computeOAuthAvailable(key: string): boolean {
    return oauthProviderRegistry.isConfigured(key);
  }

  /**
   * Idempotently synchronizes system connector definitions into PostgreSQL.
   * Overwrites type, supportedAuth, and defaultConfig so stale serverUrls are removed.
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
            iconUrl: null,
            docUrl: seed.docUrl || null,
            defaultConfig: seed.defaultConfig || {},
          },
          create: {
            id: this.getStableUuid(seed.key),
            key: seed.key,
            name: seed.name,
            description: seed.description,
            type: seed.type,
            supportedAuth: seed.supportedAuth,
            iconUrl: null,
            docUrl: seed.docUrl || null,
            isSystem: true,
            defaultConfig: seed.defaultConfig || {},
          },
        });
      }
      this.isInitialized = true;
      logger.info(
        `[ConnectorRegistry] Synchronized ${SYSTEM_CONNECTOR_SEEDS.length} system connector definitions.`,
      );
    } catch (err: any) {
      if (process.env.NODE_ENV === "production") {
        logger.error(
          `[ConnectorRegistry] Fatal: Database sync failed in production: ${err.message}`,
        );
        throw err;
      }
      logger.warn(
        `[ConnectorRegistry] Database sync skipped or failed (${err.message}). Using in-memory catalog fallback.`,
      );
    }
  }
}

export const connectorRegistry = new ConnectorRegistry();
export default connectorRegistry;
