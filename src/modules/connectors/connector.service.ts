import prisma from '../../lib/prisma';
import connectorRegistry, { SYSTEM_CONNECTOR_SEEDS, SystemConnectorSeed } from './connector.registry';
import { ConnectorDefinitionDTO, CatalogFilterQuery } from './connector.types';
import { NotFoundError } from '../../lib/errors';

export class ConnectorService {
  /**
   * Enriches a database or seed record with dynamic catalog metadata.
   */
  private enrichDefinition(
    def: {
      id: string;
      key: string;
      name: string;
      description: string;
      type: any;
      supportedAuth: any[];
      docUrl?: string | null;
      isSystem?: boolean;
      defaultConfig?: any;
      createdAt?: Date;
      updatedAt?: Date;
    },
    seed?: SystemConnectorSeed
  ): ConnectorDefinitionDTO {
    const s = seed || connectorRegistry.getSeedByKey(def.key);

    return {
      id: def.id,
      key: def.key,
      name: def.name,
      description: def.description,
      type: def.type,
      supportedAuth: def.supportedAuth,
      recommendedAuth: s?.recommendedAuth || (def.supportedAuth?.[0] as string) || 'BEARER_TOKEN',
      oauthAvailable: connectorRegistry.computeOAuthAvailable(def.key),
      requiresBaseUrl: s?.requiresBaseUrl ?? (def.type === 'MCP' || def.type === 'CUSTOM_REST'),
      baseUrlLabel: s?.baseUrlLabel,
      baseUrlPlaceholder: s?.baseUrlPlaceholder,
      authFields: s?.authFields || {},
      iconKey: s?.iconKey || def.key,
      docUrl: def.docUrl || s?.docUrl || null,
      isAvailable: s?.isAvailable ?? true,
      isSystem: def.isSystem ?? true,
      defaultConfig: def.defaultConfig || null,
      createdAt: def.createdAt,
      updatedAt: def.updatedAt,
    };
  }

  /**
   * Retrieves the catalog of available connector definitions.
   * If PostgreSQL is accessible, reads from database. Otherwise, falls back to in-memory seeds in development.
   */
  async listCatalog(filter?: CatalogFilterQuery): Promise<ConnectorDefinitionDTO[]> {
    try {
      // Ensure system definitions are synced
      await connectorRegistry.syncSystemDefinitions();

      const where: any = {};
      if (filter?.type) {
        where.type = filter.type;
      }
      if (filter?.search && filter.search.trim() !== '') {
        const query = filter.search.trim();
        where.OR = [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { key: { contains: query, mode: 'insensitive' } },
        ];
      }

      const definitions = await prisma.connectorDefinition.findMany({
        where,
        orderBy: { name: 'asc' },
      });

      if (definitions.length > 0) {
        return definitions.map((d) => this.enrichDefinition(d));
      }
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw err;
      }
      // Fallback to in-memory registry allowed only in development/test
    }

    let seeds = connectorRegistry.getSeeds();
    if (filter?.type) {
      seeds = seeds.filter((s) => s.type === filter.type);
    }
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      seeds = seeds.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.key.includes(q));
    }

    const now = new Date();
    return seeds.map((s) =>
      this.enrichDefinition(
        {
          id: connectorRegistry.getStableUuid(s.key),
          key: s.key,
          name: s.name,
          description: s.description,
          type: s.type,
          supportedAuth: s.supportedAuth,
          docUrl: s.docUrl || null,
          isSystem: true,
          defaultConfig: s.defaultConfig || null,
          createdAt: now,
          updatedAt: now,
        },
        s
      )
    );
  }

  /**
   * Retrieves a single connector definition by unique key.
   */
  async getDefinitionByKey(key: string): Promise<ConnectorDefinitionDTO> {
    try {
      const def = await prisma.connectorDefinition.findUnique({
        where: { key: key.toLowerCase() },
      });
      if (def) {
        return this.enrichDefinition(def);
      }
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw err;
      }
      // Fall through to memory in dev
    }

    const seed = connectorRegistry.getSeedByKey(key);
    if (!seed) {
      throw new NotFoundError(`Connector definition '${key}' not found in catalog`);
    }

    const now = new Date();
    return this.enrichDefinition(
      {
        id: connectorRegistry.getStableUuid(seed.key),
        key: seed.key,
        name: seed.name,
        description: seed.description,
        type: seed.type,
        supportedAuth: seed.supportedAuth,
        docUrl: seed.docUrl || null,
        isSystem: true,
        defaultConfig: seed.defaultConfig || null,
        createdAt: now,
        updatedAt: now,
      },
      seed
    );
  }
}

export const connectorService = new ConnectorService();
export default connectorService;
