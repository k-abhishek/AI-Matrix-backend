import { ConnectionStatus } from '@prisma/client';

export interface ConnectionHealthResult {
  status: ConnectionStatus;
  isHealthy: boolean;
  message?: string;
  testedAt: Date;
  details?: Record<string, any>;
}

export interface DiscoveredToolParameter {
  type: string;
  description?: string;
  required?: boolean;
  default?: any;
  enum?: any[];
}

export interface DiscoveredTool {
  name: string;
  displayName: string;
  description: string;
  inputSchema: Record<string, any>;
  outputSchema?: Record<string, any>;
  requiresApproval?: boolean;
  rateLimitPerMin?: number;
}

export interface ToolExecutionContext {
  connectionId: string;
  workspaceId: string;
  userId?: string;
  agentId?: string;
  credentials?: Record<string, any>;
  config?: Record<string, any>;
  baseUrl?: string | null;
  timeoutMs?: number;
}

export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  durationMs: number;
  metadata?: Record<string, any>;
}

export interface ConnectorConnectionContext {
  id: string;
  name: string;
  workspaceId: string;
  userId: string;
  connectorKey: string;
  authType: string;
  baseUrl?: string | null;
  config?: Record<string, any>;
  credentials?: Record<string, any>;
}

export interface BaseConnectorAdapter {
  readonly connectorType: 'NATIVE' | 'MCP' | 'CUSTOM_REST';
  testConnection(context: ConnectorConnectionContext): Promise<ConnectionHealthResult>;
  discoverTools(context: ConnectorConnectionContext): Promise<DiscoveredTool[]>;
  executeTool(
    toolName: string,
    params: Record<string, any>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult>;
}
