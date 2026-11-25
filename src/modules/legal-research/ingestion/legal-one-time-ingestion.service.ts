import fs from 'fs';
import path from 'path';
import prisma from '../../../lib/prisma';
import logger from '../../../lib/logger';
import qdrantService from '../../../services/qdrant.service';
import legalSourceService from '../sources/legal-source.service';
import legalDiscoveryService from '../discovery/legal-discovery.service';
import legalDocumentDownloader from '../downloads/document-downloader';
import legalDocumentExtractor from '../extraction/document-extractor';
import legalStructureParser from '../normalization/legal-structure-parser';
import legalMetadataExtractor from '../normalization/legal-metadata-extractor';
import legalIngestionService, { LEGAL_QDRANT_COLLECTION } from './legal-ingestion.service';

export interface OneTimeIngestionOptions {
  dryRun?: boolean;
  limit?: number;
  force?: boolean;
  reportDir?: string;
}

export interface IngestionExecutionReport {
  runId: string;
  status: string;
  dryRun: boolean;
  startedAt: string;
  completedAt: string;
  sources: Array<{
    name: string;
    status: string;
    discovered: number;
    downloaded: number;
    extracted: number;
    persisted: number;
    indexed: number;
    failed: number;
    restrictions: string[];
    errors: string[];
  }>;
  documents: {
    discovered: number;
    downloaded: number;
    extracted: number;
    persisted: number;
    indexed: number;
    failed: number;
    pendingReview: number;
    duplicatesSkipped: number;
  };
  qdrant: {
    collection: string;
    pointsCount: number;
  };
  canonicalDatabase: {
    legalDocuments: number;
    provisions: number;
    versions: number;
  };
}

export class LegalOneTimeIngestionService {
  async execute(options: OneTimeIngestionOptions = {}): Promise<IngestionExecutionReport> {
    const dryRun = Boolean(options.dryRun);
    const force = Boolean(options.force);
    const limit = options.limit;

    // 1. Idempotency check: if a COMPLETED initial run already exists and --force is not set
    if (!dryRun && !force) {
      const completedRun = await prisma.legalIngestionRun.findFirst({
        where: { runType: 'INITIAL_LEGAL_IMPORT', status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
      });
      if (completedRun && completedRun.reportJson) {
        logger.info(
          `[LegalOneTimeIngestion] Initial import already completed (runId=${completedRun.id}). Pass --force to reprocess.`
        );
        return completedRun.reportJson as unknown as IngestionExecutionReport;
      }
    }

    // 2. Upsert official Indian legal sources into existing LegalSource table
    await legalSourceService.upsertInitialLegalSources();
    const sources = await legalSourceService.getEnabledLegalSources();

    const run = dryRun
      ? { id: `dry-run-${Date.now()}`, startedAt: new Date() }
      : await prisma.legalIngestionRun.create({
          data: {
            runType: 'INITIAL_LEGAL_IMPORT',
            status: 'RUNNING',
          },
        });

    const sourceReports: IngestionExecutionReport['sources'] = [];
    let totalDiscovered = 0;
    let totalDownloaded = 0;
    let totalExtracted = 0;
    let totalPersisted = 0;
    let totalIndexed = 0;
    let totalFailed = 0;
    let totalDuplicates = 0;
    let totalPendingReview = 0;
    let remainingLimit = limit ?? Number.MAX_SAFE_INTEGER;

    for (const source of sources) {
      if (remainingLimit <= 0) break;

      const discoveryLimit = Math.min(remainingLimit, 25);
      const discovery = await legalDiscoveryService.discoverForSource(source, {
        dryRun,
        limit: discoveryLimit,
      });

      let srcDownloaded = 0;
      let srcExtracted = 0;
      let srcPersisted = 0;
      let srcIndexed = 0;
      let srcFailed = discovery.errors.length;
      const srcErrors = [...discovery.errors];

      if (dryRun) {
        totalDiscovered += discovery.discoveredCount;
        remainingLimit -= discovery.discoveredCount;
        sourceReports.push({
          name: source.name,
          status: discovery.discoveredCount > 0 ? 'DRY_RUN_DISCOVERED' : 'NO_STATIC_DOCS',
          discovered: discovery.discoveredCount,
          downloaded: 0,
          extracted: 0,
          persisted: 0,
          indexed: 0,
          failed: srcFailed,
          restrictions: discovery.skippedRestrictions,
          errors: srcErrors,
        });
        continue;
      }

      // Resume/process pending discovered documents for this source
      const pendingDocs = await prisma.discoveredLegalDocument.findMany({
        where: {
          knowledgeSourceId: source.id,
          ...(force
            ? {}
            : {
                processingStatus: { in: ['PENDING', 'FAILED'] },
              }),
        },
        take: discoveryLimit,
        orderBy: { discoveredAt: 'asc' },
      });

      for (const doc of pendingDocs) {
        if (remainingLimit <= 0) break;
        remainingLimit -= 1;

        await prisma.discoveredLegalDocument.update({
          where: { id: doc.id },
          data: { processingStatus: 'PROCESSING' },
        });

        const cfg = (source.crawlConfig || {}) as { allowedHosts?: string[]; maxDownloadBytes?: number };
        const dl = await legalDocumentDownloader.downloadAndStore(doc, {
          allowedHosts: cfg.allowedHosts,
          maxBytes: cfg.maxDownloadBytes,
        });

        if (dl.status === 'DUPLICATE') {
          totalDuplicates += 1;
          continue;
        }
        if (dl.status === 'FAILED' || !dl.buffer) {
          srcFailed += 1;
          totalFailed += 1;
          if (dl.error) srcErrors.push(`${doc.originalUrl}: ${dl.error}`);
          continue;
        }

        srcDownloaded += 1;
        totalDownloaded += 1;

        try {
          const extracted = await legalDocumentExtractor.extract(
            dl.buffer,
            dl.mimeType || 'text/html',
            doc.originalUrl,
            doc.title
          );

          if (!extracted.text || extracted.isScannedOrEmpty) {
            totalPendingReview += 1;
            await prisma.discoveredLegalDocument.update({
              where: { id: doc.id },
              data: {
                processingStatus: 'PENDING_REVIEW',
                lastError: extracted.extractionNotes.join('; ') || 'Empty or scanned content',
              },
            });
            continue;
          }

          srcExtracted += 1;
          totalExtracted += 1;

          const meta = legalMetadataExtractor.extract(
            extracted.title,
            extracted.text,
            source.sourceType
          );

          const provisions = legalStructureParser.parseProvisions(
            extracted.text,
            meta.documentType,
            meta.title
          );

          const ingested = await legalIngestionService.ingestDocument({
            title: meta.title,
            shortTitle: meta.shortTitle,
            documentType: meta.documentType,
            legalDomain: meta.legalDomain,
            jurisdiction: meta.jurisdiction,
            state: meta.state,
            actNumber: meta.actNumber,
            status: meta.status,
            sourceName: source.name,
            sourceAuthorityTier: source.authorityTier,
            sourceBaseUrl: source.baseUrl,
            sourceUrl: doc.originalUrl,
            verificationStatus: meta.verificationStatus,
            rawText: extracted.text,
            provisions,
          });

          srcPersisted += 1;
          totalPersisted += 1;
          if (!ingested.skipped && ingested.indexedChunksCount > 0) {
            srcIndexed += ingested.indexedChunksCount;
            totalIndexed += ingested.indexedChunksCount;
          }

          await prisma.discoveredLegalDocument.update({
            where: { id: doc.id },
            data: {
              legalDocumentId: ingested.documentId,
              processingStatus: 'COMPLETED',
              lastError: null,
            },
          });

          await prisma.legalIngestionRun.update({
            where: { id: run.id },
            data: { lastProcessedDocumentId: doc.id },
          });
        } catch (err: any) {
          srcFailed += 1;
          totalFailed += 1;
          srcErrors.push(`${doc.originalUrl}: ${err.message}`);
          await prisma.discoveredLegalDocument.update({
            where: { id: doc.id },
            data: {
              processingStatus: 'FAILED',
              lastError: err.message,
            },
          });
        }
      }

      totalDiscovered += discovery.discoveredCount;
      const sourceStatus =
        srcPersisted > 0 && srcFailed === 0 && discovery.skippedRestrictions.length === 0
          ? 'COMPLETED'
          : srcPersisted > 0 || discovery.discoveredCount > 0
            ? 'PARTIALLY_COMPLETED'
            : srcFailed > 0
              ? 'FAILED'
              : 'PENDING';

      await legalSourceService.updateSourceStatus(source.id, {
        ingestionStatus: sourceStatus,
        runId: run.id,
        discoveredCount: discovery.discoveredCount,
        downloadedCount: srcDownloaded,
        extractedCount: srcExtracted,
        persistedCount: srcPersisted,
        indexedCount: srcIndexed,
        failedCount: srcFailed,
        lastError: srcErrors[0] ?? discovery.skippedRestrictions[0] ?? null,
        succeeded: srcPersisted > 0,
      });

      sourceReports.push({
        name: source.name,
        status: sourceStatus,
        discovered: discovery.discoveredCount,
        downloaded: srcDownloaded,
        extracted: srcExtracted,
        persisted: srcPersisted,
        indexed: srcIndexed,
        failed: srcFailed,
        restrictions: discovery.skippedRestrictions,
        errors: srcErrors,
      });
    }

    const [legalDocumentsCount, provisionsCount, versionsCount, qdrantStats] = await Promise.all([
      prisma.legalDocument.count(),
      prisma.legalProvision.count(),
      prisma.legalDocumentVersion.count(),
      qdrantService.getCollectionStats(LEGAL_QDRANT_COLLECTION).catch(() => ({
        pointsCount: 0,
        vectorsCount: 0,
        status: 'unavailable',
      })),
    ]);

    const overallStatus = dryRun
      ? 'DRY_RUN'
      : totalPersisted > 0 && totalFailed === 0
        ? 'COMPLETED'
        : totalPersisted > 0 || totalDiscovered > 0
          ? 'PARTIALLY_COMPLETED'
          : 'FAILED';

    const completedAt = new Date();
    const report: IngestionExecutionReport = {
      runId: run.id,
      status: overallStatus,
      dryRun,
      startedAt: run.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      sources: sourceReports,
      documents: {
        discovered: totalDiscovered,
        downloaded: totalDownloaded,
        extracted: totalExtracted,
        persisted: totalPersisted,
        indexed: totalIndexed,
        failed: totalFailed,
        pendingReview: totalPendingReview,
        duplicatesSkipped: totalDuplicates,
      },
      qdrant: {
        collection: LEGAL_QDRANT_COLLECTION,
        pointsCount: qdrantStats.pointsCount,
      },
      canonicalDatabase: {
        legalDocuments: legalDocumentsCount,
        provisions: provisionsCount,
        versions: versionsCount,
      },
    };

    if (!dryRun) {
      await prisma.legalIngestionRun.update({
        where: { id: run.id },
        data: {
          status: overallStatus,
          completedAt,
          discoveredCount: totalDiscovered,
          downloadedCount: totalDownloaded,
          extractedCount: totalExtracted,
          persistedCount: totalPersisted,
          indexedCount: totalIndexed,
          failedCount: totalFailed,
          duplicateCount: totalDuplicates,
          pendingReviewCount: totalPendingReview,
          reportJson: report as any,
        },
      });
    }

    const outDir = options.reportDir || path.resolve(process.cwd(), 'reports');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, `legal-ingestion-${run.id}.json`),
      JSON.stringify(report, null, 2)
    );
    const csvRows = [
      'source,status,discovered,downloaded,extracted,persisted,indexed,failed',
      ...sourceReports.map(
        (s) =>
          `"${s.name}",${s.status},${s.discovered},${s.downloaded},${s.extracted},${s.persisted},${s.indexed},${s.failed}`
      ),
    ];
    fs.writeFileSync(path.join(outDir, `legal-ingestion-${run.id}.csv`), csvRows.join('\n'));

    return report;
  }
}

export const legalOneTimeIngestionService = new LegalOneTimeIngestionService();
export default legalOneTimeIngestionService;
