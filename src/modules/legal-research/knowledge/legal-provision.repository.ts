import prisma from '../../../lib/prisma';

export class LegalProvisionRepository {
  async findProvisionById(provisionId: string) {
    return prisma.legalProvision.findUnique({
      where: { id: provisionId },
      include: {
        document: { include: { source: true } },
        versions: { orderBy: { versionNumber: 'desc' } },
        children: { orderBy: { sortOrder: 'asc' } },
      },
    });
  }

  async findByDocumentAndNumber(documentId: string, provisionNumber: string) {
    return prisma.legalProvision.findFirst({
      where: {
        documentId,
        provisionNumber: { equals: provisionNumber.trim(), mode: 'insensitive' },
      },
      include: {
        document: { include: { source: true } },
        versions: { orderBy: { versionNumber: 'desc' } },
      },
    });
  }

  async findExactProvision(params: {
    provisionNumber: string;
    documentTitleOrShort?: string;
    documentId?: string;
    jurisdiction?: string;
    state?: string;
  }) {
    const { provisionNumber, documentTitleOrShort, documentId, jurisdiction = 'IN', state } = params;

    return prisma.legalProvision.findMany({
      where: {
        provisionNumber: { equals: provisionNumber.trim(), mode: 'insensitive' },
        ...(documentId ? { documentId } : {}),
        document: {
          jurisdiction,
          ...(state
            ? {
                OR: [{ state: null }, { state: { equals: state, mode: 'insensitive' } }],
              }
            : {}),
          ...(documentTitleOrShort
            ? {
                OR: [
                  { title: { contains: documentTitleOrShort, mode: 'insensitive' } },
                  { shortTitle: { contains: documentTitleOrShort, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
      },
      include: {
        document: { include: { source: true } },
        versions: { orderBy: { versionNumber: 'desc' } },
      },
      take: 10,
    });
  }

  async findProvisionVersionsByIds(provisionVersionIds: string[]) {
    if (provisionVersionIds.length === 0) return [];
    return prisma.legalProvisionVersion.findMany({
      where: { id: { in: provisionVersionIds } },
      include: {
        provision: {
          include: {
            document: { include: { source: true } },
          },
        },
        documentVersion: true,
      },
    });
  }

  async keywordSearchProvisions(params: {
    terms: string[];
    jurisdiction?: string;
    state?: string;
    legalDomain?: string;
    limit?: number;
  }) {
    const { terms, jurisdiction = 'IN', state, legalDomain, limit = 15 } = params;
    const cleanTerms = terms.map((t) => t.trim()).filter((t) => t.length >= 2);
    if (cleanTerms.length === 0) return [];

    return prisma.legalProvisionVersion.findMany({
      where: {
        AND: cleanTerms.map((term) => ({
          OR: [
            { exactText: { contains: term, mode: 'insensitive' } },
            { provision: { heading: { contains: term, mode: 'insensitive' } } },
            { provision: { provisionNumber: { contains: term, mode: 'insensitive' } } },
          ],
        })),
        provision: {
          document: {
            jurisdiction,
            ...(legalDomain ? { legalDomain: legalDomain as any } : {}),
            ...(state
              ? {
                  OR: [{ state: null }, { state: { equals: state, mode: 'insensitive' } }],
                }
              : {}),
          },
        },
      },
      include: {
        provision: {
          include: {
            document: { include: { source: true } },
          },
        },
      },
      take: limit,
    });
  }
}

export const legalProvisionRepository = new LegalProvisionRepository();
export default legalProvisionRepository;
