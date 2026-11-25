import legalProvisionRepository from '../knowledge/legal-provision.repository';
import legalVersionRepository from '../knowledge/legal-version.repository';
import {
  CanonicalLegalEvidence,
  LegalRetrievalOptions,
  RetrievedLegalChunk,
} from '../schemas/legal-query.schema';

/**
 * Mandatory canonical hydration:
 * - Loads canonical provision versions from PostgreSQL/Prisma
 * - Rejects missing provision IDs, invalid version IDs, unknown documents,
 *   and inconsistent document/provision relationships
 * - Resolves historical versions as of eventDate when specified
 * - Never trusts Qdrant payloads for statutory text
 */
export async function hydrateLegalEvidence(
  retrievedItems: RetrievedLegalChunk[],
  options: LegalRetrievalOptions = {}
): Promise<CanonicalLegalEvidence[]> {
  if (!retrievedItems || retrievedItems.length === 0) {
    return [];
  }

  const validItems = retrievedItems.filter(
    (item) =>
      Boolean(item.documentId) &&
      Boolean(item.provisionId) &&
      Boolean(item.provisionVersionId)
  );

  if (validItems.length === 0) {
    return [];
  }

  const versionIds = [...new Set(validItems.map((i) => i.provisionVersionId))];
  const canonicalVersions = await legalProvisionRepository.findProvisionVersionsByIds(versionIds);
  const versionMap = new Map(canonicalVersions.map((v) => [v.id, v]));

  const hydrated: CanonicalLegalEvidence[] = [];
  const seenProvisionIds = new Set<string>();

  for (const item of validItems) {
    const pv = versionMap.get(item.provisionVersionId);
    if (!pv || !pv.provision || !pv.provision.document) {
      // Reject invalid version ID or unknown document/provision reference
      continue;
    }

    // Reject inconsistent document/provision relationship
    if (
      pv.provisionId !== item.provisionId ||
      pv.provision.documentId !== item.documentId
    ) {
      continue;
    }

    let resolvedPv = pv;

    // Resolve historical version as of eventDate if requested
    if (options.eventDate) {
      const asOf = await legalVersionRepository.getProvisionAsOfDate(
        pv.provisionId,
        options.eventDate
      );
      if (asOf) {
        resolvedPv = asOf;
      }
    }

    const doc = resolvedPv.provision.document;
    const source = doc.source;

    if (
      options.requireVerifiedSource &&
      doc.verificationStatus !== 'VERIFIED'
    ) {
      continue;
    }

    if (seenProvisionIds.has(resolvedPv.provisionId)) {
      continue;
    }
    seenProvisionIds.add(resolvedPv.provisionId);

    hydrated.push({
      evidenceId: `ev_${resolvedPv.id}`,
      documentId: doc.id,
      documentTitle: doc.title,
      shortTitle: doc.shortTitle,
      documentType: doc.documentType,
      legalDomain: doc.legalDomain,
      jurisdiction: doc.jurisdiction,
      state: doc.state,
      provisionId: resolvedPv.provisionId,
      provisionVersionId: resolvedPv.id,
      provisionType: resolvedPv.provision.provisionType,
      provisionNumber: resolvedPv.provision.provisionNumber,
      heading: resolvedPv.provision.heading,
      hierarchyPath: resolvedPv.provision.hierarchyPath,
      exactText: resolvedPv.exactText,
      effectiveFrom: resolvedPv.effectiveFrom?.toISOString() ?? null,
      effectiveUntil: resolvedPv.effectiveUntil?.toISOString() ?? null,
      status: resolvedPv.status,
      commencementUncertain: resolvedPv.commencementUncertain,
      uncertaintyNote: resolvedPv.uncertaintyNote,
      sourceAuthority: source.name,
      authorityTier: source.authorityTier,
      sourceUrl: doc.sourceUrl,
      verificationStatus: doc.verificationStatus,
      score: item.score,
    });
  }

  return hydrated;
}
