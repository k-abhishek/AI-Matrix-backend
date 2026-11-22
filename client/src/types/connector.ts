export type ConnectorType = 'NATIVE' | 'MCP' | 'CUSTOM_REST';

export type ConnectionAuthType =
  | 'NONE'
  | 'API_KEY'
  | 'BEARER_TOKEN'
  | 'BASIC_AUTH'
  | 'OAUTH2_AUTHORIZATION_CODE'
  | 'OAUTH2_CLIENT_CREDENTIALS'
  | 'CUSTOM_HEADERS';

export type ConnectionStatus =
  | 'INITIALIZING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'ERROR'
  | 'EXPIRED'
  | 'REVOKED';

export type McpTransportType =
  | 'STREAMABLE_HTTP'
  | 'LEGACY_HTTP_SSE'
  | 'STDIO_ISOLATED';

export type ToolExecutionStatus =
  | 'SUCCESS'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'PERMISSION_DENIED'
  | 'APPROVAL_REQUIRED';

export interface ConnectorDefinition {
  id: string;
  key: string;
  name: string;
  description: string;
  type: ConnectorType;
  supportedAuth: ConnectionAuthType[];
  iconUrl?: string | null;
  docUrl?: string | null;
  isSystem: boolean;
  defaultConfig?: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
  connectionsCount?: number;
}

export interface ConnectorTool {
  id: string;
  connectionId: string;
  name: string;
  displayName: string;
  description: string;
  inputSchema: Record<string, any>;
  outputSchema?: Record<string, any> | null;
  schemaHash?: string | null;
  isEnabled: boolean;
  requiresApproval: boolean;
  rateLimitPerMin?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorResource {
  id: string;
  connectionId: string;
  uri: string;
  name: string;
  description?: string | null;
  mimeType?: string | null;
  isIndexed: boolean;
  lastReadAt?: string | null;
}

export interface ConnectorPrompt {
  id: string;
  connectionId: string;
  name: string;
  description?: string | null;
  arguments?: any;
}

export interface ConnectorConnection {
  id: string;
  workspaceId: string;
  userId: string;
  connectorDefinitionId: string;
  name: string;
  status: ConnectionStatus;
  authType: ConnectionAuthType;
  baseUrl?: string | null;
  mcpTransport?: McpTransportType | null;
  config?: Record<string, any> | null;
  lastConnectedAt?: string | null;
  lastTestedAt?: string | null;
  lastDiscoveredAt?: string | null;
  lastErrorMessage?: string | null;
  configVersion: number;
  createdAt: string;
  updatedAt: string;
  connectorDefinition?: ConnectorDefinition;
  tools?: ConnectorTool[];
  resources?: ConnectorResource[];
  prompts?: ConnectorPrompt[];
  _count?: {
    tools?: number;
    resources?: number;
    prompts?: number;
  };
}

export interface CatalogFilterQuery {
  type?: ConnectorType;
  search?: string;
}

export interface CreateConnectionDto {
  name: string;
  authType: ConnectionAuthType;
  connectorDefinitionId?: string;
  connectorKey?: string;
  baseUrl?: string;
  mcpTransport?: McpTransportType;
  config?: Record<string, any>;
  credentials?: Record<string, any>;
}

export interface UpdateConnectionDto {
  name?: string;
  baseUrl?: string;
  mcpTransport?: McpTransportType;
  config?: Record<string, any>;
  status?: ConnectionStatus;
  credentials?: Record<string, any>;
}

export interface ConnectionHealthResult {
  status: ConnectionStatus;
  isHealthy: boolean;
  message?: string;
  testedAt: string | Date;
  details?: Record<string, any>;
}

export interface InitiateAuthRequest {
  credentials?: Record<string, any>;
  apiKey?: string;
  token?: string;
  redirectBaseUrl?: string;
}

export interface InitiateAuthResponse {
  success: boolean;
  authorizationUrl?: string | null;
  state?: string | null;
  message?: string | null;
}

export interface DiscoverResult {
  toolsCount: number;
  resourcesCount: number;
  promptsCount: number;
  timestamp: string;
}

export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  durationMs: number;
  metadata?: Record<string, any>;
}
