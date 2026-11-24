import prisma from '../../lib/prisma';
import connectorRegistry, { SYSTEM_CONNECTOR_SEEDS } from './connector.registry';
import { ConnectorDefinitionDTO, CatalogFilterQuery } from './connector.types';
import { NotFoundError } from '../../lib/errors';

export class ConnectorService {
  /**
   * Retrieves the catalog of available connector definitions.
   * If PostgreSQL is accessible, reads from database. Otherwise, falls back to in-memory seeds.
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
        return definitions as ConnectorDefinitionDTO[];
      }
    } catch {
      // Fallback to in-memory registry
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
    return seeds.map((s) => ({
      id: `seed_${s.key}`,
      key: s.key,
      name: s.name,
      description: s.description,
      type: s.type,
      supportedAuth: s.supportedAuth,
      iconUrl: s.iconUrl || null,
      docUrl: s.docUrl || null,
      isSystem: true,
      defaultConfig: s.defaultConfig || null,
      createdAt: now,
      updatedAt: now,
    }));
  }

  /**
   * Retrieves a single connector definition by unique key.
   */
  async getDefinitionByKey(key: string): Promise<ConnectorDefinitionDTO> {
    try {
      const def = await prisma.connectorDefinition.findUnique({
        where: { key },
      });
      if (def) {
        return def as ConnectorDefinitionDTO;
      }
    } catch {
      // Fall through to memory
    }

    const seed = connectorRegistry.getSeedByKey(key);
    if (!seed) {
      throw new NotFoundError(`Connector definition '${key}' not found in catalog`);
    }

    const now = new Date();
    return {
      id: `seed_${seed.key}`,
      key: seed.key,
      name: seed.name,
      description: seed.description,
      type: seed.type,
      supportedAuth: seed.supportedAuth,
      iconUrl: seed.iconUrl || null,
      docUrl: seed.docUrl || null,
      isSystem: true,
      defaultConfig: seed.defaultConfig || null,
      createdAt: now,
      updatedAt: now,
    };
  }
}

export const connectorService = new ConnectorService();
export default connectorService;
