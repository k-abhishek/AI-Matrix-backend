import {
  LegalDocumentType,
  LegalDomain,
  LegalProvisionStatus,
  LegalVerificationStatus,
} from '@prisma/client';

export interface ExtractedLegalMetadata {
  title: string;
  shortTitle?: string;
  documentType: LegalDocumentType;
  legalDomain: LegalDomain;
  jurisdiction: string;
  state?: string;
  actNumber?: string;
  enactmentDate?: Date;
  commencementDate?: Date;
  status: LegalProvisionStatus;
  verificationStatus: LegalVerificationStatus;
}

export class LegalMetadataExtractor {
  extract(
    title: string,
    text: string,
    sourceType: string
  ): ExtractedLegalMetadata {
    const combined = `${title}\n${text.slice(0, 3000)}`.toLowerCase();

    let documentType: LegalDocumentType = 'CENTRAL_ACT';
    if (sourceType === 'JUDICIAL') {
      documentType = combined.includes('high court')
        ? 'HIGH_COURT_JUDGMENT'
        : combined.includes('tribunal')
          ? 'TRIBUNAL_DECISION'
          : 'SUPREME_COURT_JUDGMENT';
    } else if (combined.includes('constitution of india')) {
      documentType = 'CONSTITUTION';
    } else if (combined.includes('amendment act')) {
      documentType = 'AMENDMENT_ACT';
    } else if (combined.includes('notification')) {
      documentType = 'NOTIFICATION';
    } else if (combined.includes('circular')) {
      documentType = 'CIRCULAR';
    } else if (combined.includes('ordinance')) {
      documentType = 'ORDINANCE';
    } else if (combined.includes('rules,') || combined.includes(' rules ')) {
      documentType = 'RULE';
    } else if (combined.includes('regulations')) {
      documentType = 'REGULATION';
    }

    let legalDomain: LegalDomain = 'CIVIL';
    if (combined.includes('constitution')) legalDomain = 'CONSTITUTIONAL';
    else if (
      combined.includes('penal') ||
      combined.includes('nyaya sanhita') ||
      combined.includes('nagarik suraksha') ||
      combined.includes('criminal') ||
      combined.includes('sakshya') ||
      combined.includes('evidence act')
    ) {
      legalDomain = 'CRIMINAL';
    } else if (combined.includes('companies act') || combined.includes('contract act')) {
      legalDomain = 'CORPORATE_COMMERCIAL';
    } else if (combined.includes('information technology') || combined.includes('cyber')) {
      legalDomain = 'CYBER_TECHNOLOGY';
    } else if (combined.includes('gst') || combined.includes('income-tax') || combined.includes('tax')) {
      legalDomain = 'TAXATION';
    } else if (combined.includes('labour') || combined.includes('wages') || combined.includes('industrial disputes')) {
      legalDomain = 'LABOUR_EMPLOYMENT';
    }

    const actNoMatch = text.slice(0, 2000).match(/Act\s+No\.?\s*\d+\s+of\s+\d{4}/i);
    const status: LegalProvisionStatus = combined.includes('repealed')
      ? 'REPEALED'
      : 'ACTIVE';

    return {
      title: title.trim() || 'Untitled Official Legal Document',
      documentType,
      legalDomain,
      jurisdiction: 'IN',
      actNumber: actNoMatch ? actNoMatch[0] : undefined,
      status,
      // Conservative verification: discovered web documents start as PENDING_REVIEW
      // unless explicitly verified.
      verificationStatus: 'PENDING_REVIEW',
    };
  }
}

export const legalMetadataExtractor = new LegalMetadataExtractor();
export default legalMetadataExtractor;
