import exactLegalSearchService from './exact-search.service';
import keywordLegalSearchService from './keyword-search.service';
import vectorLegalSearchService from './vector-search.service';
import legalRerankerService from './reranker.service';
import { hydrateLegalEvidence } from './canonical-hydration.service';
import {
  CanonicalLegalEvidence,
  LegalRetrievalOptions,
  RetrievedLegalChunk,
} from '../schemas/legal-query.schema';

export class HybridLegalSearchService {
  async retrieveRaw(
    query: string,
    options: LegalRetrievalOptions = {},
    limit = 12
  ): Promise<RetrievedLegalChunk[]> {
    const [exactResults, keywordResults, vectorResults] = await Promise.all([
      exactLegalSearchService.search(query, options),
      keywordLegalSearchService.search(query, options, limit),
      vectorLegalSearchService.search(query, options, limit),
    ]);

    return legalRerankerService.fuseAndRerank(
      [exactResults, keywordResults, vectorResults],
      limit
    );
  }

  async searchAndHydrate(
    query: string,
    options: LegalRetrievalOptions = {},
    limit = 12
  ): Promise<CanonicalLegalEvidence[]> {
    const rawHits = await this.retrieveRaw(query, options, limit);
    return hydrateLegalEvidence(rawHits, options);
  }
}

export const hybridLegalSearchService = new HybridLegalSearchService();
export default hybridLegalSearchService;
