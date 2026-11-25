import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import legalRelationshipRepository from '../../knowledge/legal-relationship.repository';

export const getRelatedAuthoritiesTool = tool(
  async ({ provisionId, documentId }) => {
    const { relationships, citations } =
      await legalRelationshipRepository.findRelatedAuthorities({
        provisionId,
        documentId,
      });

    return JSON.stringify({
      relationships: relationships.map((r) => ({
        relationshipType: r.relationshipType,
        fromDocument: r.fromDocument.title,
        toDocument: r.toDocument.title,
        fromProvision: r.fromProvision?.provisionNumber ?? null,
        toProvision: r.toProvision?.provisionNumber ?? null,
        notes: r.notes,
      })),
      citations: citations.map((c) => ({
        sourceDocument: c.sourceDocument.title,
        targetDocument: c.targetDocument?.title ?? null,
        targetProvision: c.targetProvision?.provisionNumber ?? null,
        targetJudgment: c.targetJudgment?.caseName ?? null,
        paragraphRefs: c.paragraphRefs,
        citationText: c.citationText,
      })),
    });
  },
  {
    name: 'get_related_legal_authorities',
    description:
      'Retrieve related provisions, judgments, regulatory documents, and cross-references.',
    schema: z.object({
      provisionId: z.string().optional(),
      documentId: z.string().optional(),
      legalIssue: z.string().optional(),
    }),
  }
);
