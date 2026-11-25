import prisma from '../../../lib/prisma';

export class LegalRelationshipRepository {
  async findRelatedAuthorities(params: {
    provisionId?: string;
    documentId?: string;
  }) {
    const { provisionId, documentId } = params;
    if (!provisionId && !documentId) return { relationships: [], citations: [] };

    const [relationships, citations] = await Promise.all([
      prisma.legalRelationship.findMany({
        where: {
          OR: [
            ...(provisionId
              ? [{ fromProvisionId: provisionId }, { toProvisionId: provisionId }]
              : []),
            ...(documentId
              ? [{ fromDocumentId: documentId }, { toDocumentId: documentId }]
              : []),
          ],
        },
        include: {
          fromDocument: { include: { source: true, judgment: true } },
          toDocument: { include: { source: true, judgment: true } },
          fromProvision: true,
          toProvision: true,
        },
      }),
      prisma.legalCitation.findMany({
        where: {
          OR: [
            ...(provisionId ? [{ targetProvisionId: provisionId }] : []),
            ...(documentId
              ? [{ sourceDocumentId: documentId }, { targetDocumentId: documentId }]
              : []),
          ],
        },
        include: {
          sourceDocument: { include: { judgment: true, source: true } },
          targetDocument: { include: { judgment: true, source: true } },
          targetProvision: true,
          targetJudgment: true,
        },
      }),
    ]);

    return { relationships, citations };
  }
}

export const legalRelationshipRepository = new LegalRelationshipRepository();
export default legalRelationshipRepository;
