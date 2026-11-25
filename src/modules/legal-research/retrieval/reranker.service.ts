import { RetrievedLegalChunk } from '../schemas/legal-query.schema';

export class LegalRerankerService {
  /**
   * Combines exact, keyword, and vector search results using Reciprocal Rank Fusion (RRF)
   * with a deterministic boost for exact statutory/citation matches.
   */
  fuseAndRerank(
    lists: RetrievedLegalChunk[][],
    limit = 15,
    rrfK = 60
  ): RetrievedLegalChunk[] {
    const fusedMap = new Map<
      string,
      { item: RetrievedLegalChunk; rrfScore: number; sources: Set<string> }
    >();

    for (const list of lists) {
      list.forEach((item, rank) => {
        const key = `${item.provisionId}::${item.provisionVersionId}`;
        const sourceWeight = item.source === 'EXACT' ? 2.0 : item.source === 'KEYWORD' ? 1.2 : 1.0;
        const contribution = sourceWeight / (rrfK + rank + 1);

        const existing = fusedMap.get(key);
        if (existing) {
          existing.rrfScore += contribution;
          existing.sources.add(item.source);
          if (item.score > existing.item.score) {
            existing.item = item;
          }
        } else {
          fusedMap.set(key, {
            item,
            rrfScore: contribution,
            sources: new Set([item.source]),
          });
        }
      });
    }

    return [...fusedMap.values()]
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, limit)
      .map(({ item, rrfScore, sources }) => ({
        ...item,
        score: Number(Math.min(1, rrfScore * 20).toFixed(4)),
        source: sources.size > 1 ? 'HYBRID' : item.source,
      }));
  }
}

export const legalRerankerService = new LegalRerankerService();
export default legalRerankerService;
