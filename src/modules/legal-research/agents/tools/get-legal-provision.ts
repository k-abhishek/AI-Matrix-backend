import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import legalProvisionRepository from '../../knowledge/legal-provision.repository';
import legalVersionRepository from '../../knowledge/legal-version.repository';

export const getLegalProvisionTool = tool(
  async ({ provisionId, documentId, provisionNumber, eventDate }) => {
    let targetProvisionId = provisionId;

    if (!targetProvisionId && documentId && provisionNumber) {
      const prov = await legalProvisionRepository.findByDocumentAndNumber(
        documentId,
        provisionNumber
      );
      targetProvisionId = prov?.id;
    }

    if (!targetProvisionId) {
      return JSON.stringify({ error: 'Provide provisionId, or both documentId and provisionNumber.' });
    }

    const parsedDate = eventDate ? new Date(eventDate) : undefined;
    const version =
      parsedDate && !Number.isNaN(parsedDate.getTime())
        ? await legalVersionRepository.getProvisionAsOfDate(targetProvisionId, parsedDate)
        : await legalVersionRepository.getCurrentProvision(targetProvisionId);

    if (!version) {
      return JSON.stringify({ error: `No canonical provision version found for '${targetProvisionId}'.` });
    }

    return JSON.stringify({
      documentId: version.provision.documentId,
      documentTitle: version.provision.document.title,
      provisionId: version.provisionId,
      provisionVersionId: version.id,
      provisionNumber: version.provision.provisionNumber,
      heading: version.provision.heading,
      hierarchyPath: version.provision.hierarchyPath,
      exactText: version.exactText,
      effectiveFrom: version.effectiveFrom?.toISOString() ?? null,
      effectiveUntil: version.effectiveUntil?.toISOString() ?? null,
      status: version.status,
      commencementUncertain: version.commencementUncertain,
      sourceAuthority: version.provision.document.source.name,
      sourceUrl: version.provision.document.sourceUrl,
      verificationStatus: version.provision.document.verificationStatus,
    });
  },
  {
    name: 'get_legal_provision',
    description:
      'Retrieve exact canonical statutory text and version metadata for a legal provision from PostgreSQL.',
    schema: z.object({
      provisionId: z.string().optional(),
      documentId: z.string().optional(),
      provisionNumber: z.string().optional(),
      eventDate: z.string().optional(),
    }),
  }
);
