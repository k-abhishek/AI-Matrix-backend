import { LegalJurisdictionInfo } from '../schemas/legal-state.schema';

const INDIAN_STATES_AND_UTS = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'NCT of Delhi', 'Jammu and Kashmir', 'Ladakh', 'Chandigarh',
  'Puducherry', 'Goa', 'Daman and Diu', 'Lakshadweep', 'Andaman and Nicobar',
];

const STATE_SENSITIVE_DOMAINS = new Set([
  'LABOUR_EMPLOYMENT',
  'PROPERTY_REAL_ESTATE',
  'STATE_LEGISLATION',
  'ADMINISTRATIVE_REGULATORY',
]);

export class JurisdictionService {
  detectJurisdiction(
    query: string,
    domain?: string,
    stateHint?: string
  ): LegalJurisdictionInfo {
    const normalizedHint = stateHint?.trim();
    if (normalizedHint) {
      return {
        country: 'IN',
        state: normalizedHint,
        level: domain && STATE_SENSITIVE_DOMAINS.has(domain) ? 'CONCURRENT' : 'STATE',
        ambiguous: false,
      };
    }

    const lower = query.toLowerCase();
    for (const st of INDIAN_STATES_AND_UTS) {
      if (lower.includes(st.toLowerCase())) {
        const canonicalState = st === 'NCT of Delhi' ? 'Delhi' : st;
        return {
          country: 'IN',
          state: canonicalState,
          level: domain && STATE_SENSITIVE_DOMAINS.has(domain) ? 'CONCURRENT' : 'STATE',
          ambiguous: false,
        };
      }
    }

    const isStateSensitive = Boolean(domain && STATE_SENSITIVE_DOMAINS.has(domain));
    return {
      country: 'IN',
      level: isStateSensitive ? 'CONCURRENT' : 'CENTRAL',
      ambiguous: isStateSensitive,
    };
  }
}

export const jurisdictionService = new JurisdictionService();
export default jurisdictionService;
