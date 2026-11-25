import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import legalVersionRepository from '../../knowledge/legal-version.repository';

export const getProvisionHistoryTool = tool(
  async ({ provisionId }) => {
    const history = await legalVersionRepository.getProvisionHistory(provisionId);
    return JSON.stringify({
      provisionId,
      versions: history.versions.map((v) => ({
        provisionVersionId: v.id,
        versionNumber: v.versionNumber,
        effectiveFrom: v.effectiveFrom?.toISOString() ?? null,
        effectiveUntil: v.effectiveUntil?.toISOString() ?? null,
        isCurrent: v.isCurrent,
        status: v.status,
        commencementUncertain: v.commencementUncertain,
      })),
      amendments: history.amendments.map((a) => ({
        amendingDocumentId: a.amendingDocumentId,
        amendingTitle: a.amendingDocument.title,
        amendmentType: a.amendmentType,
        effectiveDate: a.effectiveDate?.toISOString() ?? null,
        description: a.description,
      })),
    });
  },
  {
    name: 'get_provision_history',
    description: 'Retrieve historical versions and amendment history for a statutory provision.',
    schema: z.object({
      provisionId: z.string().min(1),
    }),
  }
);
