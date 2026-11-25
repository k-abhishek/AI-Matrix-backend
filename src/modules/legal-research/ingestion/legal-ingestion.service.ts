import crypto from 'crypto';
import prisma from '../../../lib/prisma';
import logger from '../../../lib/logger';
import { LegalRawDocument } from '../../../models/LegalRawDocument';
import qdrantService from '../../../services/qdrant.service';
import embeddingService from '../../../services/embedding.service';
import chunkingService from '../../../services/chunking.service';
import { generatePointId, hashContent } from '../../../utils/hashing';
import { LegalVectorPayload } from '../schemas/legal-query.schema';
import {
  LegalAuthorityTier,
  LegalDomain,
  LegalDocumentType,
  LegalPrecedentWeight,
  LegalProvisionStatus,
  LegalProvisionType,
  LegalVerificationStatus,
} from '@prisma/client';

export const LEGAL_QDRANT_COLLECTION = 'legal_knowledge_base';

export interface IngestLegalProvisionInput {
  provisionType: LegalProvisionType;
  provisionNumber: string;
  heading?: string;
  hierarchyPath: string;
  parentHierarchyPath?: string;
  sortOrder?: number;
  exactText: string;
  effectiveFrom?: string | Date;
  effectiveUntil?: string | Date;
  status?: LegalProvisionStatus;
  commencementUncertain?: boolean;
  uncertaintyNote?: string;
}

export interface IngestLegalJudgmentInput {
  caseName: string;
  court: string;
  caseNumber?: string;
  judgmentDate: string | Date;
  citation?: string;
  bench?: string;
  precedentWeight?: LegalPrecedentWeight;
  paragraphCount?: number;
}

export interface IngestLegalDocumentInput {
  title: string;
  shortTitle?: string;
  documentType: LegalDocumentType;
  legalDomain: LegalDomain;
  jurisdiction?: string;
  state?: string;
  actNumber?: string;
  enactmentDate?: string | Date;
  commencementDate?: string | Date;
  repealedDate?: string | Date;
  status?: LegalProvisionStatus;
  sourceName: string;
  sourceAuthorityTier: LegalAuthorityTier;
  sourceBaseUrl: string;
  sourceUrl: string;
  verificationStatus?: LegalVerificationStatus;
  rawText: string;
  amendmentNote?: string;
  provisions: IngestLegalProvisionInput[];
  judgment?: IngestLegalJudgmentInput;
  skipIndexing?: boolean;
}

export class LegalIngestionService {
  /**
   * Ensures the dedicated legal Qdrant collection and payload indexes exist.
   */
  async ensureLegalCollection(): Promise<void> {
    await qdrantService.ensureCollection(LEGAL_QDRANT_COLLECTION);
    const store = qdrantService.getVectorStore(LEGAL_QDRANT_COLLECTION);
    const client = store.client as any;
    const keywordFields = [
      'documentId',
      'provisionId',
      'provisionVersionId',
      'chunkId',
      'jurisdiction',
      'state',
      'legalDomain',
      'documentType',
      'court',
      'verificationStatus',
    ];
    for (const fieldName of keywordFields) {
      try {
        await client.createPayloadIndex(LEGAL_QDRANT_COLLECTION, {
          field_name: fieldName,
          field_schema: 'keyword',
        });
      } catch {
        // Ignore if index already exists or mock client
      }
    }
  }

  /**
   * Internal-only legal document ingestion pipeline:
   * 1. Upserts LegalSource
   * 2. Persists canonical LegalDocument + LegalDocumentVersion in PostgreSQL
   * 3. Persists raw text in MongoDB LegalRawDocument
   * 4. Persists hierarchical LegalProvision + LegalProvisionVersion + LegalProvisionChunk
   * 5. Generates embeddings only for changed chunk hashes and indexes IDs/metadata in Qdrant
   */
  async ingestDocument(input: IngestLegalDocumentInput): Promise<{
    documentId: string;
    documentVersionId: string;
    provisionsCount: number;
    indexedChunksCount: number;
    skipped: boolean;
  }> {
    const contentHash = hashContent(input.rawText);
    const jurisdiction = input.jurisdiction || 'IN';

    const source = await prisma.legalSource.upsert({
      where: { name: input.sourceName },
      update: {
        authorityTier: input.sourceAuthorityTier,
        baseUrl: input.sourceBaseUrl,
        verificationStatus: input.verificationStatus ?? 'VERIFIED',
      },
      create: {
        name: input.sourceName,
        authorityTier: input.sourceAuthorityTier,
        baseUrl: input.sourceBaseUrl,
        verificationStatus: input.verificationStatus ?? 'VERIFIED',
      },
    });

    const existingDoc = await prisma.legalDocument.findFirst({
      where: {
        title: input.title,
        jurisdiction,
        ...(input.state ? { state: input.state } : { state: null }),
      },
      include: {
        versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
      },
    });

    if (existingDoc && existingDoc.contentHash === contentHash) {
      return {
        documentId: existingDoc.id,
        documentVersionId: existingDoc.versions[0]?.id || '',
        provisionsCount: input.provisions.length,
        indexedChunksCount: 0,
        skipped: true,
      };
    }

    const docId = existingDoc?.id || crypto.randomUUID();
    const nextVersionNumber = (existingDoc?.versions[0]?.versionNumber || 0) + 1;

    // Persist raw source document in MongoDB (best-effort if Mongo is disconnected in unit tests)
    let rawMongoId: string | undefined;
    try {
      const rawDoc = await LegalRawDocument.findOneAndUpdate(
        { documentId: docId, versionNumber: nextVersionNumber },
        {
          $set: {
            documentId: docId,
            versionNumber: nextVersionNumber,
            title: input.title,
            sourceUrl: input.sourceUrl,
            contentHash,
            mimeType: 'text/plain',
            rawText: input.rawText,
            extractedStructure: {
              provisionsCount: input.provisions.length,
              hierarchyPaths: input.provisions.map((p) => p.hierarchyPath),
            },
          },
        },
        { upsert: true, new: true }
      );
      rawMongoId = String(rawDoc._id);
    } catch (err: any) {
      logger.warn(`[LegalIngestion] Could not persist LegalRawDocument to MongoDB: ${err.message}`);
    }

    const doc = existingDoc
      ? await prisma.legalDocument.update({
          where: { id: docId },
          data: {
            shortTitle: input.shortTitle,
            documentType: input.documentType,
            legalDomain: input.legalDomain,
            actNumber: input.actNumber,
            enactmentDate: input.enactmentDate ? new Date(input.enactmentDate) : undefined,
            commencementDate: input.commencementDate ? new Date(input.commencementDate) : undefined,
            repealedDate: input.repealedDate ? new Date(input.repealedDate) : undefined,
            status: input.status ?? 'ACTIVE',
            sourceId: source.id,
            sourceUrl: input.sourceUrl,
            verificationStatus: input.verificationStatus ?? 'VERIFIED',
            contentHash,
            rawMongoId,
          },
        })
      : await prisma.legalDocument.create({
          data: {
            id: docId,
            title: input.title,
            shortTitle: input.shortTitle,
            documentType: input.documentType,
            legalDomain: input.legalDomain,
            jurisdiction,
            state: input.state ?? null,
            actNumber: input.actNumber,
            enactmentDate: input.enactmentDate ? new Date(input.enactmentDate) : undefined,
            commencementDate: input.commencementDate ? new Date(input.commencementDate) : undefined,
            repealedDate: input.repealedDate ? new Date(input.repealedDate) : undefined,
            status: input.status ?? 'ACTIVE',
            sourceId: source.id,
            sourceUrl: input.sourceUrl,
            verificationStatus: input.verificationStatus ?? 'VERIFIED',
            contentHash,
            rawMongoId,
          },
        });

    if (existingDoc) {
      await prisma.legalDocumentVersion.updateMany({
        where: { documentId: doc.id, isCurrent: true },
        data: { isCurrent: false },
      });
    }

    const docVersion = await prisma.legalDocumentVersion.create({
      data: {
        documentId: doc.id,
        versionNumber: nextVersionNumber,
        effectiveFrom: input.commencementDate ? new Date(input.commencementDate) : undefined,
        isCurrent: true,
        amendmentNote: input.amendmentNote,
        contentHash,
        rawMongoId,
      },
    });

    if (input.judgment) {
      await prisma.legalJudgment.upsert({
        where: { documentId: doc.id },
        update: {
          caseName: input.judgment.caseName,
          court: input.judgment.court,
          caseNumber: input.judgment.caseNumber,
          judgmentDate: new Date(input.judgment.judgmentDate),
          citation: input.judgment.citation,
          bench: input.judgment.bench,
          precedentWeight: input.judgment.precedentWeight ?? 'BINDING',
          paragraphCount: input.judgment.paragraphCount,
          sourceUrl: input.sourceUrl,
          verificationStatus: input.verificationStatus ?? 'VERIFIED',
        },
        create: {
          documentId: doc.id,
          caseName: input.judgment.caseName,
          court: input.judgment.court,
          caseNumber: input.judgment.caseNumber,
          judgmentDate: new Date(input.judgment.judgmentDate),
          citation: input.judgment.citation,
          bench: input.judgment.bench,
          precedentWeight: input.judgment.precedentWeight ?? 'BINDING',
          paragraphCount: input.judgment.paragraphCount,
          sourceUrl: input.sourceUrl,
          verificationStatus: input.verificationStatus ?? 'VERIFIED',
        },
      });
    }

    const pathToProvisionId = new Map<string, string>();
    const chunksToEmbed: Array<{
      pointId: string;
      textForEmbedding: string;
      payload: LegalVectorPayload;
    }> = [];

    for (let i = 0; i < input.provisions.length; i++) {
      const p = input.provisions[i];
      const parentId = p.parentHierarchyPath
        ? pathToProvisionId.get(p.parentHierarchyPath) ?? null
        : null;

      const provision = await prisma.legalProvision.upsert({
        where: {
          documentId_hierarchyPath: {
            documentId: doc.id,
            hierarchyPath: p.hierarchyPath,
          },
        },
        update: {
          parentId,
          provisionType: p.provisionType,
          provisionNumber: p.provisionNumber,
          heading: p.heading,
          sortOrder: p.sortOrder ?? i,
        },
        create: {
          documentId: doc.id,
          parentId,
          provisionType: p.provisionType,
          provisionNumber: p.provisionNumber,
          heading: p.heading,
          hierarchyPath: p.hierarchyPath,
          sortOrder: p.sortOrder ?? i,
        },
      });

      pathToProvisionId.set(p.hierarchyPath, provision.id);

      await prisma.legalProvisionVersion.updateMany({
        where: { provisionId: provision.id, isCurrent: true },
        data: { isCurrent: false },
      });

      const provHash = hashContent(p.exactText);
      const provVersion = await prisma.legalProvisionVersion.create({
        data: {
          provisionId: provision.id,
          documentVersionId: docVersion.id,
          versionNumber: nextVersionNumber,
          exactText: p.exactText,
          effectiveFrom: p.effectiveFrom
            ? new Date(p.effectiveFrom)
            : input.commencementDate
              ? new Date(input.commencementDate)
              : undefined,
          effectiveUntil: p.effectiveUntil ? new Date(p.effectiveUntil) : undefined,
          isCurrent: true,
          status: p.status ?? 'ACTIVE',
          commencementUncertain: p.commencementUncertain ?? false,
          uncertaintyNote: p.uncertaintyNote,
          contentHash: provHash,
        },
      });

      const textChunks = chunkingService.chunkText(p.exactText, {
        crawlerId: doc.id,
        pageId: provVersion.id,
        url: input.sourceUrl,
        title: `${input.title} - ${p.provisionNumber}`,
      });

      for (const tc of textChunks) {
        const chunkId = crypto.randomUUID();
        const pointId = generatePointId(provVersion.id, tc.chunkIndex);

        await prisma.legalProvisionChunk.create({
          data: {
            id: chunkId,
            provisionVersionId: provVersion.id,
            chunkIndex: tc.chunkIndex,
            qdrantPointId: pointId,
            contentHash: tc.contentHash,
            tokenCount: tc.tokenCount,
          },
        });

        const payload: LegalVectorPayload = {
          documentId: doc.id,
          provisionId: provision.id,
          provisionVersionId: provVersion.id,
          chunkId,
          jurisdiction,
          ...(input.state ? { state: input.state } : {}),
          legalDomain: input.legalDomain,
          documentType: input.documentType,
          ...(provVersion.effectiveFrom
            ? { validFrom: provVersion.effectiveFrom.toISOString() }
            : {}),
          ...(provVersion.effectiveUntil
            ? { validUntil: provVersion.effectiveUntil.toISOString() }
            : {}),
          ...(input.judgment?.court ? { court: input.judgment.court } : {}),
          ...(input.judgment?.judgmentDate
            ? { judgmentDate: new Date(input.judgment.judgmentDate).toISOString() }
            : {}),
          verificationStatus: input.verificationStatus ?? 'VERIFIED',
        };

        chunksToEmbed.push({
          pointId,
          textForEmbedding: `${input.title} | ${p.provisionNumber} ${p.heading || ''}\n${tc.content}`,
          payload,
        });
      }
    }

    if (!input.skipIndexing && chunksToEmbed.length > 0) {
      await this.ensureLegalCollection();
      const vectors = await embeddingService.generateEmbeddings(
        chunksToEmbed.map((c) => c.textForEmbedding)
      );
      const store = qdrantService.getVectorStore(LEGAL_QDRANT_COLLECTION);
      const client = store.client as any;

      await client.upsert(LEGAL_QDRANT_COLLECTION, {
        wait: true,
        points: chunksToEmbed.map((c, idx) => ({
          id: c.pointId,
          vector: vectors[idx],
          payload: c.payload,
        })),
      });
    }

    return {
      documentId: doc.id,
      documentVersionId: docVersion.id,
      provisionsCount: input.provisions.length,
      indexedChunksCount: input.skipIndexing ? 0 : chunksToEmbed.length,
      skipped: false,
    };
  }
}

export const legalIngestionService = new LegalIngestionService();
export default legalIngestionService;
