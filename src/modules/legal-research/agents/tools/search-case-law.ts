import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import legalCaseRepository from '../../knowledge/legal-case.repository';

export const searchCaseLawTool = tool(
  async ({ query, court, jurisdiction = 'IN', dateFrom, dateTo, provisionIds }) => {
    const cases = await legalCaseRepository.searchCaseLaw({
      query,
      court,
      jurisdiction,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      provisionIds,
    });

    return JSON.stringify({
      cases: cases.map((c) => ({
        caseId: c.id,
        documentId: c.documentId,
        caseName: c.caseName,
        court: c.court,
        caseNumber: c.caseNumber,
        judgmentDate: c.judgmentDate.toISOString().slice(0, 10),
        citation: c.citation,
        precedentWeight: c.precedentWeight,
        sourceUrl: c.sourceUrl,
        verificationStatus: c.verificationStatus,
      })),
    });
  },
  {
    name: 'search_case_law',
    description: 'Search indexed Supreme Court, High Court, and Tribunal judgments.',
    schema: z.object({
      query: z.string().min(1),
      court: z.string().optional(),
      jurisdiction: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      provisionIds: z.array(z.string()).optional(),
    }),
  }
);
