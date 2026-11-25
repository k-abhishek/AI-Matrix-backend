import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import citationValidator from '../../verification/citation-validator';

export const verifyLegalCitationTool = tool(
  async ({ documentId, provisionId, caseId, paragraphReferences }) => {
    if (caseId) {
      const res = await citationValidator.verifyJudicialCitation({
        caseId,
        paragraphReferences,
      });
      return JSON.stringify(res);
    }
    const res = await citationValidator.verifyStatutoryCitation({
      documentId,
      provisionId,
    });
    return JSON.stringify(res);
  },
  {
    name: 'verify_legal_citation',
    description:
      'Verify that a cited statutory provision or judicial decision exists and matches canonical data.',
    schema: z.object({
      documentId: z.string().min(1),
      provisionId: z.string().optional(),
      caseId: z.string().optional(),
      paragraphReferences: z.array(z.string()).optional(),
    }),
  }
);
