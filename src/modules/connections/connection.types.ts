import { ConnectionStatus, ConnectionAuthType, McpTransportType } from '@prisma/client';

export interface CreateConnectionDTO {
  connectorDefinitionId?: string;
  connectorKey?: string; // Can provide connectorKey instead of connectorDefinitionId
  name: string;
  authType: ConnectionAuthType;
  baseUrl?: string;
  mcpTransport?: McpTransportType;
  config?: Record<string, any>;
  credentials?: {
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    clientSecret?: string;
    username?: string;
    password?: string;
    customHeaders?: Record<string, string>;
    [key: string]: any;
  };
}

export interface UpdateConnectionDTO {
  name?: string;
  baseUrl?: string;
  mcpTransport?: McpTransportType;
  config?: Record<string, any>;
  status?: ConnectionStatus;
  credentials?: {
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    clientSecret?: string;
    username?: string;
    password?: string;
    customHeaders?: Record<string, string>;
    [key: string]: any;
  };
}

export interface ConnectionResponseDTO {
  id: string;
  workspaceId: string;
  userId: string;
  connectorDefinitionId: string;
  connectorKey?: string;
  name: string;
  status: ConnectionStatus;
  authType: ConnectionAuthType;
  baseUrl?: string | null;
  mcpTransport?: McpTransportType | null;
  config?: Record<string, any> | null;
  hasCredentials: boolean;
  lastConnectedAt?: Date | null;
  lastTestedAt?: Date | null;
  lastErrorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
  toolsCount?: number;
}

export interface ConnectRequestDTO {
  connectorKey: string;
  name?: string;
  authType: ConnectionAuthType;
  baseUrl?: string;
  mcpTransport?: McpTransportType;
  credentials?: Record<string, any>;
}

export type ConnectInputDTO = ConnectRequestDTO;

export type ConnectResultDTO =
  | { authUrl: string }
  | { connection: ConnectionResponseDTO; toolsCount: number };
