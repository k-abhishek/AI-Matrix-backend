import { QdrantVectorStore } from '@langchain/qdrant';
import { Document } from '@langchain/core/documents';
import env from '../config/env';
import logger from '../lib/logger';
import { generatePointId } from '../utils/hashing';
import { QdrantPointPayload, ChunkItem, CollectionStats } from '../types';
import embeddingService from './embedding.service';

export class QdrantService {
  public readonly defaultCollectionName: string;
  public readonly vectorSize: number;
  public readonly distance: 'Cosine' | 'Euclid' | 'Dot';
  private readonly embeddings: ReturnType<typeof embeddingService.getEmbeddings>;
  private readonly vectorStores = new Map<string, QdrantVectorStore>();
  private readonly initializedCollections = new Set<string>();

  constructor() {
    this.defaultCollectionName = env.QDRANT_COLLECTION;
    this.vectorSize = env.QDRANT_VECTOR_SIZE;
    this.distance = (env.QDRANT_DISTANCE as 'Cosine' | 'Euclid' | 'Dot') || 'Cosine';
    this.embeddings = embeddingService.getEmbeddings();

    // Pre-register default collection store
    this.getVectorStore(this.defaultCollectionName);
  }

  get collectionName(): string {
    return this.defaultCollectionName;
  }

  get vectorStore(): QdrantVectorStore {
    return this.getVectorStore(this.defaultCollectionName);
  }

  /**
   * Returns (and caches) a QdrantVectorStore bound to the given collection name.
   */
  getVectorStore(collectionName = this.defaultCollectionName): QdrantVectorStore {
    const existing = this.vectorStores.get(collectionName);
    if (existing) return existing;

    const store = new QdrantVectorStore(this.embeddings, {
      url: env.QDRANT_URL,
      apiKey: env.QDRANT_API_KEY || undefined,
      collectionName,
      collectionConfig: {
        vectors: {
          size: this.vectorSize,
          distance: this.distance,
        },
      },
    });

    this.vectorStores.set(collectionName, store);
    return store;
  }

  /**
   * Initializes and validates collection existence.
   */
  async ensureCollection(collectionName = this.defaultCollectionName): Promise<void> {
    if (this.initializedCollections.has(collectionName)) return;

    try {
      const store = this.getVectorStore(collectionName);
      const client = store.client as any;
      const collections = await client.getCollections();
      const exists = collections.collections?.some((c: any) => c.name === collectionName);

      if (!exists) {
        logger.info(`Creating Qdrant collection '${collectionName}' with vector size ${this.vectorSize}...`);
        await client.createCollection(collectionName, {
          vectors: {
            size: this.vectorSize,
            distance: this.distance,
          },
        });
        await this.ensurePayloadIndexes(client, collectionName);
        logger.info(`Collection '${collectionName}' created successfully.`);
      } else {
        logger.debug(`Qdrant collection '${collectionName}' exists and is ready.`);
      }

      this.initializedCollections.add(collectionName);
    } catch (err: any) {
      logger.error(`Failed to ensure Qdrant collection '${collectionName}': ${err.message}`);
      throw err;
    }
  }

  /**
   * Ensures keyword payload indexes exist for tenant-isolated KB filtering.
   */
  async ensurePayloadIndexes(client: any, collectionName: string): Promise<void> {
    const indexFields = ['knowledgeBaseId', 'workspaceId', 'scope', 'status'];
    for (const fieldName of indexFields) {
      try {
        await client.createPayloadIndex(collectionName, {
          field_name: fieldName,
          field_schema: 'keyword',
        });
      } catch {
        // Index may already exist or Qdrant mock may not implement createPayloadIndex
      }
    }
  }

  /**
   * Builds a strict Qdrant payload filter enforcing workspace & platform KB isolation.
   */
  buildTenantFilter(options: {
    workspaceId: string;
    workspaceKbIds: string[];
    platformKbIds?: string[];
    metadataFilters?: Record<string, any>;
  }): Record<string, any> {
    const { workspaceId, workspaceKbIds, platformKbIds = [], metadataFilters } = options;
    const allAllowedKbIds = [...new Set([...workspaceKbIds, ...platformKbIds])];

    const must: any[] = [
      { key: 'status', match: { value: 'ACTIVE' } },
      { key: 'knowledgeBaseId', match: { any: allAllowedKbIds } },
    ];

    const scopeClauses: any[] = [];
    if (workspaceKbIds.length > 0) {
      scopeClauses.push({
        must: [
          { key: 'scope', match: { value: 'WORKSPACE' } },
          { key: 'workspaceId', match: { value: workspaceId } },
          { key: 'knowledgeBaseId', match: { any: workspaceKbIds } },
        ],
      });
    }
    if (platformKbIds.length > 0) {
      scopeClauses.push({
        must: [
          { key: 'scope', match: { value: 'PLATFORM' } },
          { key: 'knowledgeBaseId', match: { any: platformKbIds } },
        ],
      });
    }

    if (metadataFilters) {
      for (const [k, v] of Object.entries(metadataFilters)) {
        if (v !== undefined && v !== null) {
          must.push({ key: k, match: { value: v } });
        }
      }
    }

    return {
      must,
      should: scopeClauses,
    };
  }

  /**
   * Upserts a batch of chunk vectors with their required payloads via QdrantVectorStore.
   */
  async upsertChunks(
    chunks: ChunkItem[],
    crawledAtOrEmbeddings: string | number[][],
    maybeCrawledAtOrCollection?: string,
    maybeCollectionName?: string,
    extraPayload?: Partial<QdrantPointPayload>
  ): Promise<{ upsertedCount: number; pointIds: string[] }> {
    if (chunks.length === 0) {
      return { upsertedCount: 0, pointIds: [] };
    }

    let crawledAt: string;
    let explicitEmbeddings: number[][] | undefined;
    let collectionName: string;

    if (Array.isArray(crawledAtOrEmbeddings)) {
      explicitEmbeddings = crawledAtOrEmbeddings;
      crawledAt = maybeCrawledAtOrCollection || new Date().toISOString();
      collectionName = maybeCollectionName || this.defaultCollectionName;
    } else {
      crawledAt = crawledAtOrEmbeddings;
      collectionName = maybeCollectionName || maybeCrawledAtOrCollection || this.defaultCollectionName;
    }

    await this.ensureCollection(collectionName);
    const store = this.getVectorStore(collectionName);

    const pointIds: string[] = [];
    const documents: Document[] = [];
    const customPayloads: QdrantPointPayload[] = [];

    for (const chunk of chunks) {
      const pointId = generatePointId(chunk.pageId, chunk.chunkIndex);
      pointIds.push(pointId);

      const payload: QdrantPointPayload = {
        crawlerId: chunk.crawlerId,
        pageId: chunk.pageId,
        url: chunk.url,
        title: chunk.title,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        contentHash: chunk.contentHash,
        crawledAt,
        ...(chunk.knowledgeBaseId ? { knowledgeBaseId: chunk.knowledgeBaseId } : {}),
        ...(chunk.scope ? { scope: chunk.scope } : {}),
        ...(chunk.workspaceId !== undefined ? { workspaceId: chunk.workspaceId } : {}),
        ...(chunk.documentId ? { documentId: chunk.documentId } : {}),
        ...(chunk.status ? { status: chunk.status } : {}),
        ...(extraPayload || {}),
      };

      documents.push(
        new Document({
          id: pointId,
          pageContent: chunk.title ? `${chunk.title}\n${chunk.content}` : chunk.content,
          metadata: payload,
        })
      );

      customPayloads.push(payload);
    }

    try {
      if (explicitEmbeddings && explicitEmbeddings.length > 0) {
        await store.addVectors(explicitEmbeddings, documents, {
          ids: pointIds,
          customPayload: customPayloads,
        });
      } else {
        await store.addDocuments(documents, {
          ids: pointIds,
          customPayload: customPayloads,
        });
      }

      logger.debug(
        `Upserted ${documents.length} points to Qdrant collection '${collectionName}' via QdrantVectorStore`
      );
      return {
        upsertedCount: documents.length,
        pointIds,
      };
    } catch (err: any) {
      logger.error(`Error upserting vectors to Qdrant collection '${collectionName}': ${err.message}`);
      throw err;
    }
  }

  /**
   * Deletes obsolete points by specific point IDs.
   */
  async deletePoints(
    pointIds: string[],
    collectionName = this.defaultCollectionName
  ): Promise<void> {
    if (pointIds.length === 0) return;
    await this.ensureCollection(collectionName);

    try {
      const store = this.getVectorStore(collectionName);
      await store.delete({ ids: pointIds });
      logger.debug(
        `Deleted ${pointIds.length} obsolete points from Qdrant collection '${collectionName}'`
      );
    } catch (err: any) {
      logger.warn(`Failed to delete obsolete points from Qdrant collection '${collectionName}': ${err.message}`);
    }
  }

  /**
   * Deletes all points belonging to a specific crawlerId.
   */
  async deleteByCrawlerId(
    crawlerId: string,
    collectionName = this.defaultCollectionName
  ): Promise<void> {
    await this.ensureCollection(collectionName);
    try {
      const store = this.getVectorStore(collectionName);
      await store.delete({
        filter: {
          should: [
            { key: 'crawlerId', match: { value: crawlerId } },
            { key: 'metadata.crawlerId', match: { value: crawlerId } },
            { key: 'customPayload.crawlerId', match: { value: crawlerId } },
          ],
        },
      });
      logger.info(`Deleted points for crawlerId '${crawlerId}' from Qdrant collection '${collectionName}'`);
    } catch (err: any) {
      logger.error(`Failed to delete points for crawlerId '${crawlerId}' in '${collectionName}': ${err.message}`);
      throw err;
    }
  }

  /**
   * Deletes an entire Qdrant collection.
   */
  async deleteCollection(collectionName: string): Promise<void> {
    try {
      const client = this.vectorStore.client as any;
      const collections = await client.getCollections();
      const exists = collections.collections?.some((c: any) => c.name === collectionName);
      if (exists) {
        await client.deleteCollection(collectionName);
        logger.info(`Deleted Qdrant collection '${collectionName}'.`);
      }
      this.vectorStores.delete(collectionName);
      this.initializedCollections.delete(collectionName);
    } catch (err: any) {
      logger.error(`Failed to delete Qdrant collection '${collectionName}': ${err.message}`);
      throw err;
    }
  }

  /**
   * Lists all existing collection names in Qdrant.
   */
  async listCollections(): Promise<string[]> {
    try {
      const client = this.vectorStore.client as any;
      const collections = await client.getCollections();
      return (collections.collections || []).map((c: any) => c.name).filter(Boolean);
    } catch (err: any) {
      logger.warn(`Could not list Qdrant collections: ${err.message}`);
      return [];
    }
  }

  /**
   * Retrieves collection info and metrics.
   */
  async getCollectionStats(collectionName = this.defaultCollectionName): Promise<CollectionStats> {
    try {
      await this.ensureCollection(collectionName);
      const store = this.getVectorStore(collectionName);
      const client = store.client as any;
      const info = await client.getCollection(collectionName);
      const pointsCount = info.points_count || 0;
      const vectorsCount =
        info.vectors_count || info.indexed_vectors_count || pointsCount;

      return {
        pointsCount,
        vectorsCount,
        status: info.status || 'green',
      };
    } catch (err: any) {
      logger.warn(`Could not fetch collection stats for '${collectionName}': ${err.message}`);
      return {
        pointsCount: 0,
        vectorsCount: 0,
        status: 'unavailable',
      };
    }
  }

  /**
   * Health check method for readiness probe.
   */
  async checkHealth(): Promise<boolean> {
    try {
      const client = this.vectorStore.client as any;
      await client.getCollections();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Similarity search helper leveraging QdrantVectorStore.
   */
  async similaritySearch(
    query: string,
    k = 4,
    filter?: any,
    collectionName = this.defaultCollectionName
  ): Promise<Document[]> {
    await this.ensureCollection(collectionName);
    const store = this.getVectorStore(collectionName);
    return store.similaritySearch(query, k, filter);
  }

  /**
   * Similarity search with score helper leveraging QdrantVectorStore.
   * Returns documents along with their similarity score (0.0 - 1.0).
   */
  async similaritySearchWithScore(
    query: string,
    k = 10,
    filter?: any,
    collectionName = this.defaultCollectionName
  ): Promise<[Document, number][]> {
    await this.ensureCollection(collectionName);
    const store = this.getVectorStore(collectionName);
    return store.similaritySearchWithScore(query, k, filter);
  }

  /**
   * Searches across multiple Qdrant collections in parallel using a single query embedding,
   * then merges and sorts results descending by similarity score.
   */
  async similaritySearchWithScoreAcrossCollections(
    query: string,
    k = 10,
    collectionNames?: string[],
    filter?: any
  ): Promise<[Document, number][]> {
    const targets =
      collectionNames && collectionNames.length > 0
        ? collectionNames
        : await this.listCollections();

    if (targets.length === 0) {
      return [];
    }

    if (targets.length === 1) {
      return this.similaritySearchWithScore(query, k, filter, targets[0]);
    }

    const queryVector = await this.embeddings.embedQuery(query);

    const perCollectionResults = await Promise.all(
      targets.map(async (colName) => {
        try {
          await this.ensureCollection(colName);
          const store = this.getVectorStore(colName);
          return await store.similaritySearchVectorWithScore(queryVector, k, filter);
        } catch (err: any) {
          logger.warn(`Similarity search failed on collection '${colName}': ${err.message}`);
          return [] as [Document, number][];
        }
      })
    );

    return perCollectionResults
      .flat()
      .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
      .slice(0, k);
  }
}

export const qdrantService = new QdrantService();
export default qdrantService;
export { QdrantPointPayload, CollectionStats };
