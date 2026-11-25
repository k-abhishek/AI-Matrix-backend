import prisma from '../../../lib/prisma';

export class LegalVersionRepository {
  async getCurrentProvision(provisionId: string) {
    return prisma.legalProvisionVersion.findFirst({
      where: {
        provisionId,
        isCurrent: true,
      },
      include: {
        provision: {
          include: {
            document: { include: { source: true } },
          },
        },
        documentVersion: true,
      },
      orderBy: { versionNumber: 'desc' },
    });
  }

  async getProvisionAsOfDate(provisionId: string, eventDate: Date) {
    const matching = await prisma.legalProvisionVersion.findFirst({
      where: {
        provisionId,
        AND: [
          {
            OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: eventDate } }],
          },
          {
            OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: eventDate } }],
          },
        ],
      },
      include: {
        provision: {
          include: {
            document: { include: { source: true } },
          },
        },
        documentVersion: true,
      },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNumber: 'desc' }],
    });

    return matching;
  }

  async getProvisionHistory(provisionId: string) {
    const [versions, amendments] = await Promise.all([
      prisma.legalProvisionVersion.findMany({
        where: { provisionId },
        include: {
          documentVersion: true,
        },
        orderBy: [{ versionNumber: 'asc' }],
      }),
      prisma.legalAmendment.findMany({
        where: { targetProvisionId: provisionId },
        include: {
          amendingDocument: true,
          targetDocument: true,
        },
        orderBy: { effectiveDate: 'asc' },
      }),
    ]);

    return { versions, amendments };
  }

  async getDocumentAmendments(documentId: string) {
    return prisma.legalAmendment.findMany({
      where: {
        OR: [{ targetDocumentId: documentId }, { amendingDocumentId: documentId }],
      },
      include: {
        amendingDocument: true,
        targetDocument: true,
        targetProvision: true,
      },
      orderBy: { effectiveDate: 'asc' },
    });
  }
}

export const legalVersionRepository = new LegalVersionRepository();
export default legalVersionRepository;
