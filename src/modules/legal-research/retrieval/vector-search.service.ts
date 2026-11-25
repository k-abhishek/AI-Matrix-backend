import qdrantService from '../../../services/qdrant.service';
import embeddingService from '../../../services/embedding.service';
import logger from '../../../lib/logger';
import { LEGAL_QDRANT_COLLECTION } from '../ingestion/legal-ingestion.service';
import {
  LegalRetrievalOptions,
  LegalVectorPayload,
  RetrievedLegalChunk,
} from '../schemas/legal-query.schema';

export class VectorLegalSearchService {
  buildQdrantFilter(options: LegalRetrievalOptions): Record<string, any> | undefined {
    const must: any[] = [];

    if (options.jurisdiction) {
      must.push({ key: 'jurisdiction', match: { value: options.jurisdiction } });
    }
    if (options.legalDomain) {
      must.push({ key: 'legalDomain', match: { value: options.legalDomain } });
    }
    if (options.documentType) {
      must.push({ key: 'documentType', match: { value: options.documentType } });
    }
    if (options.requireVerifiedSource) {
      must.push({ key: 'verificationStatus', match: { value: 'VERIFIED' } });
    }

    const should: any[] = [];
    if (options.state) {
      should.push({ key: 'state', match: { value: options.state } });
    }

    if (must.length === 0 && should.length === 0) {
      return undefined;
    }

    return {
      ...(must.length > 0 ? { must } : {}),
      ...(should.length > 0 ? { should } : {}),
    };
  }

  /**
   * Queries Qdrant's dedicated legal_knowledge_base collection and returns ONLY
   * identifiers, scores, and retrieval metadata—never statutory text.
   */
  async search(
    query: string,
    options: LegalRetrievalOptions = {},
    limit = 10,
    scoreThreshold = 0.35
  ): Promise<RetrievedLegalChunk[]> {
    try {
      await qdrantService.ensureCollection(LEGAL_QDRANT_COLLECTION);
      const store = qdrantService.getVectorStore(LEGAL_QDRANT_COLLECTION);
      const client = store.client as any;

      const [queryVector] = await embeddingService.generateEmbeddings([query.trim()]);
      if (!queryVector || queryVector.length === 0) {
        return [];
      }

      const filter = this.buildQdrantFilter(options);
      let hits: any[] = [];
      if (typeof client.query === 'function') {
        const res = await client.query(LEGAL_QDRANT_COLLECTION, {
          query: queryVector,
          limit,
          filter,
          with_payload: true,
          score_threshold: scoreThreshold,
        });
        hits = Array.isArray(res?.points) ? res.points : [];
      } else if (typeof client.search === 'function') {
        hits = await client.search(LEGAL_QDRANT_COLLECTION, {
          vector: queryVector,
          limit,
          filter,
          with_payload: true,
          score_threshold: scoreThreshold,
        });
      }

      return (hits || [])
        .map((hit) => {
          const payload = (hit.payload || {}) as Partial<LegalVectorPayload>;
          if (!payload.documentId || !payload.provisionId || !payload.provisionVersionId) {
            return null;
          }
          return {
            chunkId: payload.chunkId || String(hit.id),
            documentId: payload.documentId,
            provisionId: payload.provisionId,
            provisionVersionId: payload.provisionVersionId,
            score: Number((hit.score ?? 0).toFixed(4)),
            source: 'VECTOR' as const,
            metadata: payload,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
    } catch (err: any) {
      logger.warn(`[VectorLegalSearch] Qdrant search failed, falling back to DB search: ${err.message}`);
      return [];
    }
  }
}

export const vectorLegalSearchService = new VectorLegalSearchService();
export default vectorLegalSearchService;
