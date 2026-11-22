import { McpTransportType, ConnectionAuthType, ConnectionStatus } from '@prisma/client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export interface McpClientSession {
  client: Client;
  transport: Transport;
  connectionId: string;
  serverUrl: string;
  transportType: McpTransportType;
  createdAt: Date;
  lastUsedAt: Date;
  isAlive: boolean;
  serverCapabilities?: Record<string, any>;
  serverInfo?: {
    name: string;
    version?: string;
  };
}

export interface McpTransportOptions {
  serverUrl: string;
  transportType?: McpTransportType;
  headers?: Record<string, string>;
  timeoutMs?: number;
  sessionId?: string;
}

export interface McpAuthConfig {
  authType: ConnectionAuthType;
  token?: string;
  apiKey?: string;
  headerName?: string;
  customHeaders?: Record<string, string>;
  expiresAt?: Date | null;
  refreshToken?: string;
}

export interface McpDiscoveredTool {
  name: string;
  displayName: string;
  description: string;
  inputSchema: Record<string, any>;
  outputSchema?: Record<string, any>;
  schemaHash: string;
  requiresApproval?: boolean;
  rateLimitPerMin?: number;
}

export interface McpDiscoveredResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpDiscoveredPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface McpDiscoverySummary {
  connectionId: string;
  toolsCount: number;
  resourcesCount: number;
  promptsCount: number;
  tools: McpDiscoveredTool[];
  resources: McpDiscoveredResource[];
  prompts: McpDiscoveredPrompt[];
  discoveredAt: Date;
}

export interface McpCallToolParams {
  connectionId: string;
  toolName: string;
  parameters: Record<string, any>;
  timeoutMs?: number;
}

export interface McpProbeResult {
  isHealthy: boolean;
  serverInfo?: {
    name: string;
    version?: string;
  };
  protocolVersion?: string;
  capabilities: {
    tools: boolean;
    resources: boolean;
    prompts: boolean;
    logging: boolean;
  };
  tools: McpDiscoveredTool[];
  resources: McpDiscoveredResource[];
  prompts: McpDiscoveredPrompt[];
  latencyMs: number;
  testedAt: Date;
}
