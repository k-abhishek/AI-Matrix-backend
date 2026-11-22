import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { connectorCatalogApi, connectionApi } from '../api/connector';
import type {
  CatalogFilterQuery,
  CreateConnectionDto,
  UpdateConnectionDto,
  InitiateAuthRequest,
} from '../types';

export const connectorKeys = {
  catalog: (params?: CatalogFilterQuery) => ['connectors', 'catalog', params] as const,
  definition: (key: string) => ['connectors', 'definition', key] as const,
  allConnections: ['connections'] as const,
  connection: (id: string) => ['connections', id] as const,
  tools: (id: string) => ['connections', id, 'tools'] as const,
  resources: (id: string) => ['connections', id, 'resources'] as const,
  prompts: (id: string) => ['connections', id, 'prompts'] as const,
};

// ============================================================================
// Catalog Hooks
// ============================================================================

export function useConnectorCatalog(params?: CatalogFilterQuery) {
  return useQuery({
    queryKey: connectorKeys.catalog(params),
    queryFn: () => connectorCatalogApi.getCatalog(params),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useConnectorDefinition(key: string, enabled = true) {
  return useQuery({
    queryKey: connectorKeys.definition(key),
    queryFn: () => connectorCatalogApi.getByKey(key),
    enabled: Boolean(key) && enabled,
    staleTime: 60_000,
  });
}

// ============================================================================
// Connections Hooks
// ============================================================================

export function useConnections(options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: connectorKeys.allConnections,
    queryFn: () => connectionApi.list(),
    staleTime: 15_000,
    refetchInterval: options?.refetchInterval,
    placeholderData: keepPreviousData,
  });
}

export function useConnection(id: string, enabled = true) {
  return useQuery({
    queryKey: connectorKeys.connection(id),
    queryFn: () => connectionApi.getById(id),
    enabled: Boolean(id) && enabled,
    staleTime: 15_000,
  });
}

export function useConnectionTools(connectionId: string, enabled = true) {
  return useQuery({
    queryKey: connectorKeys.tools(connectionId),
    queryFn: () => connectionApi.getTools(connectionId),
    enabled: Boolean(connectionId) && enabled,
    staleTime: 15_000,
  });
}

export function useCreateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateConnectionDto) => connectionApi.create(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectorKeys.allConnections });
    },
  });
}

export function useUpdateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateConnectionDto }) =>
      connectionApi.update(id, dto),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: connectorKeys.allConnections });
      queryClient.invalidateQueries({ queryKey: connectorKeys.connection(id) });
    },
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => connectionApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectorKeys.allConnections });
    },
  });
}

export function useInitiateAuth() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req?: InitiateAuthRequest }) =>
      connectionApi.initiateAuth(id, req),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: connectorKeys.connection(id) });
      queryClient.invalidateQueries({ queryKey: connectorKeys.allConnections });
    },
  });
}

export function useTestConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => connectionApi.test(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: connectorKeys.connection(id) });
      queryClient.invalidateQueries({ queryKey: connectorKeys.allConnections });
    },
  });
}

export function useDiscoverTools() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => connectionApi.discover(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: connectorKeys.tools(id) });
      queryClient.invalidateQueries({ queryKey: connectorKeys.connection(id) });
      queryClient.invalidateQueries({ queryKey: connectorKeys.allConnections });
    },
  });
}

export function useExecuteTool() {
  return useMutation({
    mutationFn: ({
      connectionId,
      toolName,
      parameters,
    }: {
      connectionId: string;
      toolName: string;
      parameters?: Record<string, any>;
    }) => connectionApi.executeTool(connectionId, toolName, parameters),
  });
}
