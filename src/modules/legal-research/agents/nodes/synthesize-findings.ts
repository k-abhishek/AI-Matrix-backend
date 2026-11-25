import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { LegalResearchStateType } from '../legal-research.state';
import { LEGAL_SYNTHESIS_PROMPT } from '../../prompts/legal-research.prompts';
import { LegalFinding } from '../../schemas/legal-response.schema';

export async function synthesizeFindingsNode(
  state: LegalResearchStateType,
  model?: BaseChatModel
): Promise<Partial<LegalResearchStateType>> {
  const fallbackFindings: LegalFinding[] = state.canonicalEvidence.map((ev) => ({
    issue: ev.heading || `${ev.documentTitle} (${ev.provisionNumber})`,
    conclusion: `Applicable provision under ${ev.documentTitle} (${ev.provisionNumber}).`,
    reasoning: ev.exactText,
    confidence: ev.verificationStatus === 'VERIFIED' ? 'HIGH' : 'LOW',
    evidenceIds: [ev.evidenceId],
  }));

  if (!model || state.canonicalEvidence.length === 0) {
    return {
      legalFindings: fallbackFindings,
      legalIssues: fallbackFindings.map((f) => f.issue),
    };
  }

  try {
    const evidenceContext = state.canonicalEvidence.map((e) => ({
      evidenceId: e.evidenceId,
      documentTitle: e.documentTitle,
      provisionNumber: e.provisionNumber,
      heading: e.heading,
      status: e.status,
      exactText: e.exactText,
      sourceAuthority: e.sourceAuthority,
    }));

    const resp = await model.invoke([
      new SystemMessage(LEGAL_SYNTHESIS_PROMPT),
      new HumanMessage(
        JSON.stringify({
          userQuery: state.userQuery,
          domain: state.domain,
          jurisdiction: state.jurisdiction,
          eventDate: state.eventDate,
          facts: state.facts,
          canonicalEvidence: evidenceContext,
          caseLaw: state.caseLaw,
        })
      ),
    ]);

    const text = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const findings: LegalFinding[] = Array.isArray(parsed.legalFindings)
        ? parsed.legalFindings
        : fallbackFindings;
      return {
        legalFindings: findings,
        legalIssues: Array.isArray(parsed.legalIssues)
          ? parsed.legalIssues
          : findings.map((f) => f.issue),
        facts: {
          ...state.facts,
          synthesizedSummary: parsed.summary,
          recommendedActions: parsed.recommendedActions || [],
          risks: parsed.risks || [],
          limitations: parsed.limitations || [],
        },
      };
    }
  } catch {
    // Fall back to deterministic synthesis
  }

  return {
    legalFindings: fallbackFindings,
    legalIssues: fallbackFindings.map((f) => f.issue),
  };
}
