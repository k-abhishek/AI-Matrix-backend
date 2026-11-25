import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import legalDocumentRepository from '../../knowledge/legal-document.repository';

export const getLegalDocumentTool = tool(
  async ({ documentId, versionId }) => {
    const doc = await legalDocumentRepository.findById(documentId);
    if (!doc) {
      return JSON.stringify({ error: `LegalDocument '${documentId}' not found.` });
    }

    const version = versionId
      ? doc.versions.find((v) => v.id === versionId)
      : doc.versions[0];

    return JSON.stringify({
      documentId: doc.id,
      title: doc.title,
      shortTitle: doc.shortTitle,
      documentType: doc.documentType,
      legalDomain: doc.legalDomain,
      jurisdiction: doc.jurisdiction,
      state: doc.state,
      actNumber: doc.actNumber,
      enactmentDate: doc.enactmentDate?.toISOString() ?? null,
      commencementDate: doc.commencementDate?.toISOString() ?? null,
      repealedDate: doc.repealedDate?.toISOString() ?? null,
      status: doc.status,
      sourceAuthority: doc.source.name,
      authorityTier: doc.source.authorityTier,
      sourceUrl: doc.sourceUrl,
      verificationStatus: doc.verificationStatus,
      selectedVersion: version
        ? {
            id: version.id,
            versionNumber: version.versionNumber,
            effectiveFrom: version.effectiveFrom?.toISOString() ?? null,
            effectiveUntil: version.effectiveUntil?.toISOString() ?? null,
            isCurrent: version.isCurrent,
            amendmentNote: version.amendmentNote,
          }
        : null,
    });
  },
  {
    name: 'get_legal_document',
    description: 'Retrieve canonical legal document metadata and version structure.',
    schema: z.object({
      documentId: z.string().min(1),
      versionId: z.string().optional(),
    }),
  }
);
