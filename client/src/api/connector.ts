import apiClient from './client';
import type {
  ApiResponse,
  ConnectorDefinition,
  ConnectorConnection,
  ConnectorTool,
  ConnectorResource,
  ConnectorPrompt,
  CatalogFilterQuery,
  CreateConnectionDto,
  UpdateConnectionDto,
  ConnectionHealthResult,
  InitiateAuthRequest,
  InitiateAuthResponse,
  DiscoverResult,
  ToolExecutionResult,
} from '../types';

export const connectorCatalogApi = {
  /**
   * Fetch all connector definitions available in the platform catalog.
   */
  getCatalog: async (params?: CatalogFilterQuery): Promise<ConnectorDefinition[]> => {
    const queryParams: Record<string, string> = {};
    if (params?.type) queryParams.type = params.type;
    if (params?.search) queryParams.search = params.search;

    const res = await apiClient.get<ApiResponse<ConnectorDefinition[]>>('/connectors/catalog', {
      params: queryParams,
    });
    return res.data || [];
  },

  /**
   * Fetch a single connector definition by unique key.
   */
  getByKey: async (key: string): Promise<ConnectorDefinition> => {
    const res = await apiClient.get<ApiResponse<ConnectorDefinition>>(`/connectors/catalog/${key}`);
    return res.data!;
  },
};

export const connectionApi = {
  /**
   * List all connections configured for current workspace.
   */
  list: async (): Promise<ConnectorConnection[]> => {
    const res = await apiClient.get<ApiResponse<ConnectorConnection[]>>('/connections');
    return res.data || [];
  },

  /**
   * Get single connection details by ID.
   */
  getById: async (id: string): Promise<ConnectorConnection> => {
    const res = await apiClient.get<ApiResponse<ConnectorConnection>>(`/connections/${id}`);
    return res.data!;
  },

  /**
   * Create a new connection instance.
   */
  create: async (dto: CreateConnectionDto): Promise<ConnectorConnection> => {
    const res = await apiClient.post<ApiResponse<ConnectorConnection>>('/connections', dto);
    return res.data!;
  },

  /**
   * Update existing connection configuration or status.
   */
  update: async (id: string, dto: UpdateConnectionDto): Promise<ConnectorConnection> => {
    const res = await apiClient.patch<ApiResponse<ConnectorConnection>>(`/connections/${id}`, dto);
    return res.data!;
  },

  /**
   * Permanently delete a connection and all its credentials & discovered tools.
   */
  delete: async (id: string): Promise<{ success: boolean; message: string; id: string }> => {
    return apiClient.delete<{ success: boolean; message: string; id: string }>(`/connections/${id}`);
  },

  /**
   * Initiate authentication: direct credentials submission or OAuth flow initiation.
   */
  initiateAuth: async (id: string, req?: InitiateAuthRequest): Promise<InitiateAuthResponse> => {
    return apiClient.post<InitiateAuthResponse>(`/connections/${id}/auth`, req || {});
  },

  /**
   * Trigger health check and latency ping against connection.
   */
  test: async (id: string): Promise<ConnectionHealthResult> => {
    const res = await apiClient.post<ApiResponse<ConnectionHealthResult>>(`/connections/${id}/test`);
    return res.data!;
  },

  /**
   * Trigger tool, resource, and prompt discovery against remote server.
   */
  discover: async (id: string): Promise<DiscoverResult> => {
    const res = await apiClient.post<ApiResponse<DiscoverResult>>(`/connections/${id}/discover`);
    return res.data!;
  },

  /**
   * Get discovered tools for a connection.
   */
  getTools: async (id: string): Promise<ConnectorTool[]> => {
    const res = await apiClient.get<ApiResponse<ConnectorTool[]>>(`/connections/${id}/tools`);
    return res.data || [];
  },

  /**
   * Get discovered resources for a connection.
   */
  getResources: async (id: string): Promise<ConnectorResource[]> => {
    const res = await apiClient.get<ApiResponse<ConnectorResource[]>>(`/connections/${id}/resources`);
    return res.data || [];
  },

  /**
   * Get discovered prompts for a connection.
   */
  getPrompts: async (id: string): Promise<ConnectorPrompt[]> => {
    const res = await apiClient.get<ApiResponse<ConnectorPrompt[]>>(`/connections/${id}/prompts`);
    return res.data || [];
  },

  /**
   * Execute a tool on the connection in a live sandbox test.
   */
  executeTool: async (
    id: string,
    toolName: string,
    parameters: Record<string, any> = {}
  ): Promise<ToolExecutionResult> => {
    const res = await apiClient.post<ApiResponse<ToolExecutionResult>>(`/connections/${id}/execute`, {
      toolName,
      parameters,
    });
    return (res.data || res) as ToolExecutionResult;
  },
};
