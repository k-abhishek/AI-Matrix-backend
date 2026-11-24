import qdrantService, { QdrantService } from "../../services/qdrant.service";
import logger from "../../lib/logger";
import { sanitizeCollectionName } from "../../utils/hashing";
import {
  SearchQueryInput,
  SearchResponseData,
  SearchResultItem,
} from "../../types";

export const DEFAULT_SCORE_THRESHOLD = 0.5;

export class SearchService {
  constructor(private qdrant: QdrantService = qdrantService) {}

  /**
   * Executes semantic similarity search against the Qdrant collection.
   * Enforces a default score threshold of 0.5 to exclude low-relevance results.
   */
  async search(input: SearchQueryInput): Promise<SearchResponseData> {
    const trimmedQuery = input.query.trim();
    const page = Math.max(1, input.page || 1);
    const limit = Math.min(100, Math.max(1, input.limit || 10));
    const scoreThreshold = input.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;

    // Calculate how many top candidates to fetch from vector store to satisfy pagination
    const fetchK = Math.min(100, Math.max(page * limit, 10));

    const rawTarget = input.collectionName || input.crawlerName;
    const targetCollection = rawTarget ? sanitizeCollectionName(rawTarget) : undefined;

    logger.debug(
      `Executing semantic search: query="${trimmedQuery}", collection=${targetCollection || 'ALL'}, fetchK=${fetchK}, page=${page}, limit=${limit}, scoreThreshold=${scoreThreshold}`,
    );

    const scoredDocs = targetCollection
      ? await this.qdrant.similaritySearchWithScore(
          trimmedQuery,
          fetchK,
          undefined,
          targetCollection,
        )
      : await this.qdrant.similaritySearchWithScoreAcrossCollections(
          trimmedQuery,
          fetchK,
        );

    // Filter out low-relevance matches below the score threshold (default 0.5)
    const filteredDocs = scoredDocs.filter(
      ([, score]) => score >= scoreThreshold,
    );

    const total = filteredDocs.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const pageSlice = filteredDocs.slice(startIndex, endIndex);

    const results: SearchResultItem[] = pageSlice.map(([doc, score]) => ({
      id: String(doc.id || ""),
      score: Number(score.toFixed(4)),
      content: doc.pageContent,
      metadata: (doc.metadata as any) || {},
    }));

    return {
      query: trimmedQuery,
      total,
      page,
      limit,
      results,
    };
  }
}

export const searchService = new SearchService();
export default searchService;
