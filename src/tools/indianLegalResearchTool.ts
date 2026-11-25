import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import modelFactoryService from '../services/modelFactory.service';
import { runIndianLegalResearch, LegalResearchResponse } from '../modules/legal-research';
import logger from '../lib/logger';

function formatLegalResearchForAgent(res: LegalResearchResponse): string {
  const lines: string[] = [
    `Status: ${res.status}`,
    `Domain: ${res.domain}`,
    `Jurisdiction: ${res.jurisdiction.country}${res.jurisdiction.state ? ` (${res.jurisdiction.state})` : ''} [${res.jurisdiction.level}]`,
    `As Of Date: ${res.asOfDate}${res.eventDate ? ` | Event Date: ${res.eventDate}` : ''}`,
    `Sources Verified: ${res.sourcesVerified ? 'Yes' : 'No'} | Consult Lawyer Recommended: ${res.requiresLawyer ? 'Yes' : 'No'}`,
    '',
    `Summary: ${res.summary}`,
  ];

  if (res.applicableLaws.length > 0) {
    lines.push('', 'Applicable Statutory Provisions:');
    res.applicableLaws.forEach((law, idx) => {
      lines.push(
        `[${idx + 1}] ${law.title} — ${law.provisionNumber} (${law.sourceAuthority}, ${law.verificationStatus})`,
        `    Source: ${law.sourceUrl}`,
        `    Text: ${law.exactText}`
      );
    });
  }

  if (res.legalFindings.length > 0) {
    lines.push('', 'Legal Findings:');
    for (const f of res.legalFindings) {
      lines.push(`- ${f.issue} [Confidence: ${f.confidence}]: ${f.conclusion} (${f.reasoning})`);
    }
  }

  if (res.caseLaw.length > 0) {
    lines.push('', 'Relevant Case Law:');
    for (const c of res.caseLaw) {
      lines.push(`- ${c.caseName} (${c.court}, ${c.judgmentDate}) ${c.citation || ''} — ${c.relevance} (${c.sourceUrl})`);
    }
  }

  if (res.missingInformation.length > 0) {
    lines.push('', 'Missing Information Needed for Definitive Assessment:');
    for (const m of res.missingInformation) {
      lines.push(`- ${m}`);
    }
  }

  if (res.recommendedActions.length > 0) {
    lines.push('', 'Recommended Next Steps:');
    for (const a of res.recommendedActions) {
      lines.push(`- ${a}`);
    }
  }

  if (res.limitations.length > 0) {
    lines.push('', 'Limitations & Disclaimer:');
    for (const l of res.limitations) {
      lines.push(`- ${l}`);
    }
  }

  return lines.join('\n');
}

export const indianLegalResearchTool = tool(
  async ({ query, state, eventDate, facts }) => {
    try {
      let model: any;
      try {
        const created = modelFactoryService.createModel({
          temperature: 0.1,
          streaming: false,
        });
        model = created.model;
      } catch (err: any) {
        logger.warn(`[indian_legal_research] Model init fallback to deterministic mode: ${err.message}`);
      }

      const result = await runIndianLegalResearch(
        {
          userQuery: query,
          stateHint: state,
          eventDateHint: eventDate,
          contextFacts: facts,
        },
        model
      );

      return formatLegalResearchForAgent(result);
    } catch (err: any) {
      logger.error(`[indian_legal_research] Execution error: ${err.message}`);
      return `Legal research could not be completed due to an internal error: ${err.message}. Please consult a qualified Indian legal practitioner.`;
    }
  },
  {
    name: 'indian_legal_research',
    description:
      'Specialized Indian Legal Research Agent. Use for questions about Indian legislation, Constitution, criminal law (IPC/BNS/CrPC/BNSS), corporate law (Companies Act), labour law, taxation (GST), property/tenancy law, and judicial precedents. Returns verified statutory provisions, temporal/jurisdictional applicability, and structured evidence-backed findings.',
    schema: z.object({
      query: z.string().min(1).describe('The legal question or issue to research'),
      state: z.string().optional().describe('Indian state or UT if known (e.g., Karnataka)'),
      eventDate: z.string().optional().describe('ISO date (YYYY-MM-DD) when the incident occurred'),
      facts: z.record(z.string(), z.unknown()).optional().describe('Relevant extracted user facts'),
    }),
  }
);
