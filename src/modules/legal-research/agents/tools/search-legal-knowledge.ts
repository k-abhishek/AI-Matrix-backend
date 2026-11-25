import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import hybridLegalSearchService from '../../retrieval/hybrid-search.service';

export const searchLegalKnowledgeTool = tool(
  async ({ query, domain, jurisdiction = 'IN', state, documentType, eventDate, limit = 8 }) => {
    const rawHits = await hybridLegalSearchService.retrieveRaw(
      query,
      {
        legalDomain: domain,
        jurisdiction,
        state,
        documentType,
        eventDate: eventDate ? new Date(eventDate) : undefined,
      },
      limit
    );

    if (rawHits.length === 0) {
      return JSON.stringify({ results: [], message: 'No matching legal provisions found.' });
    }

    // Return identifiers, scores, and retrieval metadata only (canonical text via get_legal_provision)
    return JSON.stringify({
      results: rawHits.map((r) => ({
        chunkId: r.chunkId,
        documentId: r.documentId,
        provisionId: r.provisionId,
        provisionVersionId: r.provisionVersionId,
        score: r.score,
        source: r.source,
        metadata: r.metadata,
      })),
    });
  },
  {
    name: 'search_legal_knowledge',
    description:
      'Hybrid search across the Indian Legal Knowledge Base. Returns canonical identifiers, scores, and retrieval metadata.',
    schema: z.object({
      query: z.string().min(1),
      domain: z.string().optional(),
      jurisdiction: z.string().optional(),
      state: z.string().optional(),
      documentType: z.string().optional(),
      eventDate: z.string().optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }),
  }
);
