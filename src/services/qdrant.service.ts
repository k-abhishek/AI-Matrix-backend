import { QdrantVectorStore } from '@langchain/qdrant';
import { Document } from '@langchain/core/documents';
import env from '../config/env';
import logger from '../lib/logger';
import { generatePointId } from '../utils/hashing';
import { QdrantPointPayload, ChunkItem, CollectionStats } from '../types';
import embeddingService from './embedding.service';

export class QdrantService {
  public readonly vectorStore: QdrantVectorStore;
  public readonly collectionName: string;
  public readonly vectorSize: number;
  public readonly distance: 'Cosine' | 'Euclid' | 'Dot';
  private isInitialized = false;

  constructor() {
    this.collectionName = env.QDRANT_COLLECTION;
    this.vectorSize = env.QDRANT_VECTOR_SIZE;
    this.distance = (env.QDRANT_DISTANCE as 'Cosine' | 'Euclid' | 'Dot') || 'Cosine';

    const embeddings = embeddingService.getEmbeddings();

    this.vectorStore = new QdrantVectorStore(embeddings, {
      url: env.QDRANT_URL,
      apiKey: env.QDRANT_API_KEY || undefined,
      collectionName: this.collectionName,
      collectionConfig: {
        vectors: {
          size: this.vectorSize,
          distance: this.distance,
        },
      },
    });
  }

  /**
   * Initializes and validates collection existence.
   */
  async ensureCollection(): Promise<void> {
    if (this.isInitialized) return;

    try {
      const client = this.vectorStore.client as any;
      const collections = await client.getCollections();
      const exists = collections.collections?.some((c: any) => c.name === this.collectionName);

      if (!exists) {
        logger.info(`Creating Qdrant collection '${this.collectionName}' with vector size ${this.vectorSize}...`);
        await client.createCollection(this.collectionName, {
          vectors: {
            size: this.vectorSize,
            distance: this.distance,
          },
        });
        logger.info(`Collection '${this.collectionName}' created successfully.`);
      } else {
        logger.debug(`Qdrant collection '${this.collectionName}' exists and is ready.`);
      }

      this.isInitialized = true;
    } catch (err: any) {
      logger.error(`Failed to ensure Qdrant collection: ${err.message}`);
      throw err;
    }
  }

  /**
   * Upserts a batch of chunk vectors with their required payloads via QdrantVectorStore.
   */
  async upsertChunks(
    chunks: ChunkItem[],
    crawledAtOrEmbeddings: string | number[][],
    maybeCrawledAt?: string
  ): Promise<{ upsertedCount: number; pointIds: string[] }> {
    if (chunks.length === 0) {
      return { upsertedCount: 0, pointIds: [] };
    }

    await this.ensureCollection();

    let crawledAt: string;
    let explicitEmbeddings: number[][] | undefined;

    if (Array.isArray(crawledAtOrEmbeddings)) {
      explicitEmbeddings = crawledAtOrEmbeddings;
      crawledAt = maybeCrawledAt || new Date().toISOString();
    } else {
      crawledAt = crawledAtOrEmbeddings;
    }

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
        await this.vectorStore.addVectors(explicitEmbeddings, documents, {
          ids: pointIds,
          customPayload: customPayloads,
        });
      } else {
        await this.vectorStore.addDocuments(documents, {
          ids: pointIds,
          customPayload: customPayloads,
        });
      }

      logger.debug(
        `Upserted ${documents.length} points to Qdrant collection '${this.collectionName}' via QdrantVectorStore`
      );
      return {
        upsertedCount: documents.length,
        pointIds,
      };
    } catch (err: any) {
      logger.error(`Error upserting vectors to Qdrant: ${err.message}`);
      throw err;
    }
  }

  /**
   * Deletes obsolete points by specific point IDs.
   */
  async deletePoints(pointIds: string[]): Promise<void> {
    if (pointIds.length === 0) return;
    await this.ensureCollection();

    try {
      await this.vectorStore.delete({ ids: pointIds });
      logger.debug(`Deleted ${pointIds.length} obsolete points from Qdrant via QdrantVectorStore`);
    } catch (err: any) {
      logger.warn(`Failed to delete obsolete points from Qdrant: ${err.message}`);
    }
  }

  /**
   * Deletes all points belonging to a specific crawlerId.
   */
  async deleteByCrawlerId(crawlerId: string): Promise<void> {
    await this.ensureCollection();
    try {
      await this.vectorStore.delete({
        filter: {
          should: [
            { key: 'crawlerId', match: { value: crawlerId } },
            { key: 'metadata.crawlerId', match: { value: crawlerId } },
            { key: 'customPayload.crawlerId', match: { value: crawlerId } },
          ],
        },
      });
      logger.info(`Deleted points for crawlerId '${crawlerId}' from Qdrant via QdrantVectorStore`);
    } catch (err: any) {
      logger.error(`Failed to delete points for crawlerId: ${err.message}`);
      throw err;
    }
  }

  /**
   * Retrieves collection info and metrics.
   */
  async getCollectionStats(): Promise<CollectionStats> {
    try {
      await this.ensureCollection();
      const client = this.vectorStore.client as any;
      const info = await client.getCollection(this.collectionName);
      const pointsCount = info.points_count || 0;
      const vectorsCount =
        info.vectors_count || info.indexed_vectors_count || pointsCount;

      return {
        pointsCount,
        vectorsCount,
        status: info.status || 'green',
      };
    } catch (err: any) {
      logger.warn(`Could not fetch collection stats: ${err.message}`);
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
  async similaritySearch(query: string, k = 4, filter?: any): Promise<Document[]> {
    await this.ensureCollection();
    return this.vectorStore.similaritySearch(query, k, filter);
  }

  /**
   * Similarity search with score helper leveraging QdrantVectorStore.
   * Returns documents along with their similarity score (0.0 - 1.0).
   */
  async similaritySearchWithScore(
    query: string,
    k = 10,
    filter?: any
  ): Promise<[Document, number][]> {
    await this.ensureCollection();
    return this.vectorStore.similaritySearchWithScore(query, k, filter);
  }
}

export const qdrantService = new QdrantService();
export default qdrantService;
export { QdrantPointPayload, CollectionStats };
