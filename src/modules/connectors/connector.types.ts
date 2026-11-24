import { ConnectorType, ConnectionAuthType } from '@prisma/client';

export interface ConnectorDefinitionDTO {
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
  createdAt: Date;
  updatedAt: Date;
}

export interface CatalogFilterQuery {
  type?: ConnectorType;
  search?: string;
}
