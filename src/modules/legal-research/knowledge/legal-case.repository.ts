import prisma from '../../../lib/prisma';

export class LegalCaseRepository {
  async findById(caseId: string) {
    return prisma.legalJudgment.findUnique({
      where: { id: caseId },
      include: {
        document: {
          include: {
            source: true,
            provisions: {
              include: {
                versions: { where: { isCurrent: true } },
              },
            },
          },
        },
      },
    });
  }

  async searchCaseLaw(params: {
    query?: string;
    court?: string;
    jurisdiction?: string;
    dateFrom?: Date;
    dateTo?: Date;
    provisionIds?: string[];
    limit?: number;
  }) {
    const { query, court, jurisdiction = 'IN', dateFrom, dateTo, provisionIds, limit = 10 } = params;

    return prisma.legalJudgment.findMany({
      where: {
        ...(court ? { court: { contains: court, mode: 'insensitive' } } : {}),
        ...(dateFrom || dateTo
          ? {
              judgmentDate: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {}),
              },
            }
          : {}),
        document: {
          jurisdiction,
          ...(query
            ? {
                OR: [
                  { title: { contains: query, mode: 'insensitive' } },
                  {
                    provisions: {
                      some: {
                        versions: {
                          some: {
                            exactText: { contains: query, mode: 'insensitive' },
                          },
                        },
                      },
                    },
                  },
                ],
              }
            : {}),
        },
        ...(provisionIds && provisionIds.length > 0
          ? {
              OR: [
                {
                  document: {
                    relationshipsFrom: {
                      some: { toProvisionId: { in: provisionIds } },
                    },
                  },
                },
                {
                  document: {
                    citationsFrom: {
                      some: { targetProvisionId: { in: provisionIds } },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        document: {
          include: {
            source: true,
            provisions: {
              include: {
                versions: { where: { isCurrent: true }, take: 3 },
              },
              take: 3,
            },
          },
        },
      },
      orderBy: { judgmentDate: 'desc' },
      take: limit,
    });
  }
}

export const legalCaseRepository = new LegalCaseRepository();
export default legalCaseRepository;
