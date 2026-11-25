import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { LegalResearchStateType } from '../legal-research.state';
import { LEGAL_CLASSIFICATION_PROMPT } from '../../prompts/legal-research.prompts';

const DOMAIN_KEYWORDS: Array<{ domain: string; patterns: RegExp[] }> = [
  { domain: 'CONSTITUTIONAL', patterns: [/\barticle\s+\d+/i, /\bconstitution\b/i, /\bfundamental right/i] },
  { domain: 'CRIMINAL', patterns: [/\barrest\b/i, /\bwarrant\b/i, /\bipc\b/i, /\bbns\b/i, /\bcrpc\b/i, /\bbnss\b/i, /\bfir\b/i, /\bcheat/i] },
  { domain: 'CORPORATE_COMMERCIAL', patterns: [/\bcompanies act\b/i, /\bdirector/i, /\bfraud\b/i, /\bshareholder/i, /\bcorporate\b/i] },
  { domain: 'LABOUR_EMPLOYMENT', patterns: [/\bemployer\b/i, /\bemployee\b/i, /\bsalary\b/i, /\bwage/i, /\bterminat/i, /\bprobation\b/i, /\bretrench/i] },
  { domain: 'PROPERTY_REAL_ESTATE', patterns: [/\btenant\b/i, /\blandlord\b/i, /\brent\b/i, /\beviction\b/i, /\bproperty\b/i, /\blease\b/i] },
  { domain: 'TAXATION', patterns: [/\bgst\b/i, /\bcgst\b/i, /\bincome tax\b/i, /\btax evasion\b/i] },
];

export function heuristicClassify(query: string): {
  domain: string;
  eventDate?: string;
  searchQueries: string[];
} {
  let domain = 'CIVIL';
  for (const entry of DOMAIN_KEYWORDS) {
    if (entry.patterns.some((p) => p.test(query))) {
      domain = entry.domain;
      break;
    }
  }

  let eventDate: string | undefined;
  const isoMatch = query.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const yearMatch = query.match(/\b(19\d{2}|20[0-2]\d)\b/);
  if (isoMatch) {
    eventDate = isoMatch[1];
  } else if (yearMatch) {
    eventDate = `${yearMatch[1]}-06-01`;
  }

  return {
    domain,
    eventDate,
    searchQueries: [query.trim()],
  };
}

export async function classifyQueryNode(
  state: LegalResearchStateType,
  model?: BaseChatModel
): Promise<Partial<LegalResearchStateType>> {
  const fallback = heuristicClassify(state.userQuery);

  if (!model) {
    return {
      domain: state.domain || fallback.domain,
      eventDate: state.eventDate || fallback.eventDate,
      searchQueries: fallback.searchQueries,
    };
  }

  try {
    const resp = await model.invoke([
      new SystemMessage(LEGAL_CLASSIFICATION_PROMPT),
      new HumanMessage(state.userQuery),
    ]);
    const text = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        domain: parsed.domain || fallback.domain,
        facts: parsed.facts && typeof parsed.facts === 'object' ? parsed.facts : {},
        missingInformation: Array.isArray(parsed.missingInformation) ? parsed.missingInformation : [],
        needsClarification: Boolean(parsed.needsClarification),
        eventDate: parsed.eventDate || state.eventDate || fallback.eventDate,
        searchQueries:
          Array.isArray(parsed.searchQueries) && parsed.searchQueries.length > 0
            ? parsed.searchQueries
            : fallback.searchQueries,
      };
    }
  } catch {
    // Fall back to deterministic classification
  }

  return {
    domain: state.domain || fallback.domain,
    eventDate: state.eventDate || fallback.eventDate,
    searchQueries: fallback.searchQueries,
  };
}
