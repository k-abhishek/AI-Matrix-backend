const AUTHORITY_RANK: Record<string, number> = {
  PRIMARY_LEGISLATION: 7,
  OFFICIAL_AMENDMENT: 6,
  OFFICIAL_NOTIFICATION: 5,
  BINDING_JUDICIAL: 4,
  PERSUASIVE_JUDICIAL: 3,
  SECONDARY_COMMENTARY: 2,
  UNVERIFIED: 1,
};

export class SourceValidator {
  getAuthorityRank(authorityTier: string): number {
    return AUTHORITY_RANK[authorityTier] ?? 1;
  }

  isAuthoritativePrimaryOrJudicial(authorityTier: string): boolean {
    return this.getAuthorityRank(authorityTier) >= 3;
  }

  isPrimaryLegislation(authorityTier: string): boolean {
    return (
      authorityTier === 'PRIMARY_LEGISLATION' ||
      authorityTier === 'OFFICIAL_AMENDMENT' ||
      authorityTier === 'OFFICIAL_NOTIFICATION'
    );
  }
}

export const sourceValidator = new SourceValidator();
export default sourceValidator;
