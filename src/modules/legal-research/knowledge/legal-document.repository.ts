import prisma from '../../../lib/prisma';
import { LegalRawDocument } from '../../../models/LegalRawDocument';
import { LegalDomain, LegalDocumentType, LegalVerificationStatus } from '@prisma/client';

export class LegalDocumentRepository {
  async findById(documentId: string) {
    return prisma.legalDocument.findUnique({
      where: { id: documentId },
      include: {
        source: true,
        versions: { orderBy: { versionNumber: 'desc' } },
      },
    });
  }

  async findByTitleOrShortTitle(query: string, limit = 10) {
    const trimmed = query.trim();
    if (!trimmed) return [];

    return prisma.legalDocument.findMany({
      where: {
        OR: [
          { title: { contains: trimmed, mode: 'insensitive' } },
          { shortTitle: { contains: trimmed, mode: 'insensitive' } },
          { actNumber: { contains: trimmed, mode: 'insensitive' } },
        ],
      },
      include: { source: true },
      take: limit,
    });
  }

  async findApplicableDocuments(params: {
    jurisdiction?: string;
    state?: string;
    eventDate?: Date;
    legalDomain?: LegalDomain;
    documentType?: LegalDocumentType;
    limit?: number;
  }) {
    const { jurisdiction = 'IN', state, eventDate, legalDomain, documentType, limit = 25 } = params;

    return prisma.legalDocument.findMany({
      where: {
        jurisdiction,
        ...(legalDomain ? { legalDomain } : {}),
        ...(documentType ? { documentType } : {}),
        ...(state
          ? {
              OR: [{ state: null }, { state: { equals: state, mode: 'insensitive' } }],
            }
          : {}),
        ...(eventDate
          ? {
              AND: [
                {
                  OR: [
                    { commencementDate: null },
                    { commencementDate: { lte: eventDate } },
                  ],
                },
                {
                  OR: [{ repealedDate: null }, { repealedDate: { gt: eventDate } }],
                },
              ],
            }
          : {}),
      },
      include: { source: true },
      take: limit,
      orderBy: { commencementDate: 'desc' },
    });
  }

  async getRawDocument(documentId: string, versionNumber = 1) {
    return LegalRawDocument.findOne({ documentId, versionNumber }).lean();
  }

  async findSourceByName(name: string) {
    return prisma.legalSource.findUnique({ where: { name } });
  }

  async upsertSource(input: {
    name: string;
    authorityTier: any;
    baseUrl: string;
    description?: string;
    verificationStatus?: LegalVerificationStatus;
  }) {
    return prisma.legalSource.upsert({
      where: { name: input.name },
      update: {
        authorityTier: input.authorityTier,
        baseUrl: input.baseUrl,
        description: input.description,
        verificationStatus: input.verificationStatus ?? 'VERIFIED',
      },
      create: {
        name: input.name,
        authorityTier: input.authorityTier,
        baseUrl: input.baseUrl,
        description: input.description,
        verificationStatus: input.verificationStatus ?? 'VERIFIED',
      },
    });
  }
}

export const legalDocumentRepository = new LegalDocumentRepository();
export default legalDocumentRepository;
