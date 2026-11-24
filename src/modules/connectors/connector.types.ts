import { ConnectorType, ConnectionAuthType } from '@prisma/client';

export interface CatalogAuthField {
  name: string;
  label: string;
  type: 'text' | 'password';
  placeholder?: string;
  helpText?: string;
  required: boolean;
}

export interface ConnectorDefinitionDTO {
  id: string;
  key: string;
  name: string;
  description: string;
  type: ConnectorType;
  supportedAuth: ConnectionAuthType[];
  recommendedAuth: string;
  oauthAvailable: boolean;
  requiresBaseUrl: boolean;
  baseUrlLabel?: string;
  baseUrlPlaceholder?: string;
  authFields: Record<string, CatalogAuthField[]>;
  iconKey: string;
  docUrl?: string | null;
  isAvailable: boolean;
  isSystem?: boolean;
  defaultConfig?: Record<string, any> | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CatalogFilterQuery {
  type?: ConnectorType;
  search?: string;
}
