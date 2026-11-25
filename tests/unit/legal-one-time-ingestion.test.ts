import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '../../src/lib/prisma';
import legalSourceService from '../../src/modules/legal-research/sources/legal-source.service';
import legalLinkExtractor from '../../src/modules/legal-research/discovery/link-extractor';
import legalDocumentDownloader from '../../src/modules/legal-research/downloads/document-downloader';
import legalDocumentExtractor from '../../src/modules/legal-research/extraction/document-extractor';
import legalStructureParser from '../../src/modules/legal-research/normalization/legal-structure-parser';
import legalMetadataExtractor from '../../src/modules/legal-research/normalization/legal-metadata-extractor';
import legalOneTimeIngestionService from '../../src/modules/legal-research/ingestion/legal-one-time-ingestion.service';

describe('One-Time Indian Legal KB Ingestion Pipeline', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('upserts official Indian legal sources idempotently without duplicating records', async () => {
    const findSpy = vi.spyOn(prisma.legalSource, 'findFirst').mockResolvedValue(null);
    const createSpy = vi
      .spyOn(prisma.legalSource, 'create')
      .mockImplementation(async (args: any) => ({ id: `src-${args.data.sourceKey}`, ...args.data }));

    const res = await legalSourceService.upsertInitialLegalSources();
    expect(res).toHaveLength(5);
    expect(findSpy).toHaveBeenCalledTimes(5);
    expect(createSpy).toHaveBeenCalledTimes(5);
  });

  it('extracts and prioritizes legal document links from HTML', () => {
    const html = `
      <html><body>
        <a href="/handle/123456789/20062">Bharatiya Nyaya Sanhita, 2023</a>
        <a href="/bitstream/123456/1/bns.pdf">Download BNS PDF</a>
        <a href="/login">Login</a>
      </body></html>
    `;
    const links = legalLinkExtractor.extractLinks(
      html,
      'https://www.indiacode.nic.in/',
      ['www.indiacode.nic.in'],
      ['/login']
    );

    expect(links.some((l) => l.fileType === 'PDF')).toBe(true);
    expect(links.some((l) => l.url.includes('/login'))).toBe(false);
    expect(links[0].priorityScore).toBeGreaterThan(0);
  });

  it('validates allowed MIME types for legal documents', () => {
    expect(legalDocumentDownloader.isAllowedMime('application/pdf; charset=utf-8')).toBe(true);
    expect(legalDocumentDownloader.isAllowedMime('text/html')).toBe(true);
    expect(legalDocumentDownloader.isAllowedMime('image/png')).toBe(false);
  });

  it('extracts HTML content and parses statutory provisions preserving wording', async () => {
    const html = `
      <html><head><title>Test Act, 2023</title></head>
      <body><main>
        <p>Section 1. Short title. This Act may be called the Test Act, 2023.</p>
        <p>Section 2. Definitions. In this Act, unless the context otherwise requires.</p>
      </main></body></html>
    `;
    const extracted = await legalDocumentExtractor.extract(
      Buffer.from(html, 'utf-8'),
      'text/html',
      'https://www.indiacode.nic.in/test',
      'Test Act, 2023'
    );
    expect(extracted.isScannedOrEmpty).toBe(false);

    const meta = legalMetadataExtractor.extract(extracted.title, extracted.text, 'LEGISLATION');
    expect(meta.documentType).toBe('CENTRAL_ACT');
    expect(meta.verificationStatus).toBe('PENDING_REVIEW');

    const provisions = legalStructureParser.parseProvisions(
      extracted.text,
      meta.documentType,
      meta.title
    );
    expect(provisions.length).toBeGreaterThanOrEqual(2);
    expect(provisions[0].provisionNumber).toBe('Section 1');
  });

  it('skips full re-ingestion when a COMPLETED initial run already exists and --force is not passed', async () => {
    const mockReport = { runId: 'run-done', status: 'COMPLETED' };
    vi.spyOn(prisma.legalIngestionRun, 'findFirst').mockResolvedValue({
      id: 'run-done',
      status: 'COMPLETED',
      reportJson: mockReport,
    } as any);

    const upsertSpy = vi.spyOn(legalSourceService, 'upsertInitialLegalSources');
    const result = await legalOneTimeIngestionService.execute({ force: false });

    expect(result.runId).toBe('run-done');
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});
