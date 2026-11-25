import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import legalProvisionRepository from '../../knowledge/legal-provision.repository';
import { hydrateLegalEvidence } from '../../retrieval/canonical-hydration.service';
import temporalAnalysisService from '../../reasoning/temporal-analysis.service';
import jurisdictionService from '../../reasoning/jurisdiction.service';
import applicabilityService from '../../reasoning/applicability.service';

export const assessLegalApplicabilityTool = tool(
  async ({ facts, evidenceIds, eventDate, jurisdiction }) => {
    const versionIds = evidenceIds.map((id) => (id.startsWith('ev_') ? id.slice(3) : id));
    const versions = await legalProvisionRepository.findProvisionVersionsByIds(versionIds);

    const hydrated = await hydrateLegalEvidence(
      versions.map((v) => ({
        chunkId: `assess_${v.id}`,
        documentId: v.provision.documentId,
        provisionId: v.provisionId,
        provisionVersionId: v.id,
        score: 1.0,
        source: 'EXACT',
        metadata: {},
      })),
      { eventDate: eventDate ? new Date(eventDate) : undefined }
    );

    const jInfo = jurisdictionService.detectJurisdiction(
      JSON.stringify(facts),
      undefined,
      jurisdiction
    );
    const temporal = temporalAnalysisService.analyzeTemporalApplicability(eventDate, hydrated);
    const assessment = applicabilityService.filterAndAssess({
      evidence: hydrated,
      jurisdiction: jInfo,
      temporal,
    });

    return JSON.stringify({
      factsAssumed: facts,
      jurisdiction: jInfo,
      temporal,
      applicableCount: assessment.applicableEvidence.length,
      applicableEvidenceIds: assessment.applicableEvidence.map((e) => e.evidenceId),
      excludedEvidence: assessment.excludedEvidence,
      notes: assessment.notes,
    });
  },
  {
    name: 'assess_legal_applicability',
    description:
      'Assess temporal and jurisdictional applicability of retrieved canonical evidence against stated facts.',
    schema: z.object({
      facts: z.record(z.string(), z.unknown()),
      evidenceIds: z.array(z.string()),
      eventDate: z.string().optional(),
      jurisdiction: z.string().optional(),
    }),
  }
);
