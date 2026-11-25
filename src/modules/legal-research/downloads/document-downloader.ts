import crypto from 'crypto';
import prisma from '../../../lib/prisma';
import { LegalRawDocument } from '../../../models/LegalRawDocument';
import { validateSafeUrl, normalizeUrl } from '../../../utils/url';
import logger from '../../../lib/logger';

const ALLOWED_MIME_PREFIXES = [
  'application/pdf',
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'application/xml',
  'text/xml',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/octet-stream',
];

export interface DownloadResult {
  discoveredDocId: string;
  status: 'DOWNLOADED' | 'DUPLICATE' | 'FAILED';
  buffer?: Buffer;
  mimeType?: string;
  fileSize?: number;
  sha256?: string;
  storageReference?: string;
  error?: string;
}

export class LegalDocumentDownloader {
  isAllowedMime(mimeType: string): boolean {
    const clean = mimeType.split(';')[0].trim().toLowerCase();
    return ALLOWED_MIME_PREFIXES.some((prefix) => clean.startsWith(prefix));
  }

  async downloadAndStore(
    discoveredDoc: {
      id: string;
      knowledgeSourceId: string;
      title: string;
      originalUrl: string;
      canonicalUrl: string;
      fileType: string;
    },
    options: {
      allowedHosts?: string[];
      timeoutMs?: number;
      maxBytes?: number;
      maxRedirects?: number;
    } = {}
  ): Promise<DownloadResult> {
    const timeoutMs = options.timeoutMs ?? 20000;
    const maxBytes = options.maxBytes ?? 20 * 1024 * 1024;
    const maxRedirects = options.maxRedirects ?? 5;

    let currentUrl = discoveredDoc.originalUrl;
    let redirects = 0;

    try {
      let response: Response | null = null;
      while (redirects <= maxRedirects) {
        validateSafeUrl(currentUrl, options.allowedHosts);
        const res = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            'User-Agent': 'AIMatrixLegalIngestor/1.0 (+official-public-legal-research)',
            Accept: 'application/pdf,text/html,application/xhtml+xml,application/xml,application/json,text/plain,*/*;q=0.8',
          },
        });

        if ([301, 302, 303, 307, 308].includes(res.status)) {
          redirects += 1;
          const loc = res.headers.get('location');
          if (!loc) throw new Error(`Redirect (${res.status}) missing Location header`);
          const next = normalizeUrl(loc, currentUrl);
          if (!next) throw new Error(`Invalid redirect target: ${loc}`);
          currentUrl = next;
          continue;
        }

        response = res;
        break;
      }

      if (!response) {
        throw new Error(`Exceeded maximum redirects (${maxRedirects})`);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const mimeType = (response.headers.get('content-type') || 'application/octet-stream')
        .split(';')[0]
        .trim()
        .toLowerCase();

      if (!this.isAllowedMime(mimeType)) {
        throw new Error(`Unsupported MIME type: ${mimeType}`);
      }

      const arrayBuf = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      if (buffer.length === 0) {
        throw new Error('Downloaded file is empty');
      }
      if (buffer.length > maxBytes) {
        throw new Error(`File size ${buffer.length} exceeds limit ${maxBytes}`);
      }

      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

      // Deduplicate by SHA-256 across already downloaded documents
      const duplicate = await prisma.discoveredLegalDocument.findFirst({
        where: {
          sha256,
          id: { not: discoveredDoc.id },
          downloadStatus: 'DOWNLOADED',
        },
      });

      if (duplicate) {
        await prisma.discoveredLegalDocument.update({
          where: { id: discoveredDoc.id },
          data: {
            sha256,
            mimeType,
            fileSize: buffer.length,
            downloadedAt: new Date(),
            downloadStatus: 'DUPLICATE',
            processingStatus: 'COMPLETED',
            storageReference: duplicate.storageReference,
            legalDocumentId: duplicate.legalDocumentId,
          },
        });
        return {
          discoveredDocId: discoveredDoc.id,
          status: 'DUPLICATE',
          mimeType,
          fileSize: buffer.length,
          sha256,
          storageReference: duplicate.storageReference ?? undefined,
        };
      }

      // Persist raw original file in MongoDB LegalRawDocument
      const rawTextPreview = mimeType.startsWith('text/') || mimeType.includes('html') || mimeType.includes('xml') || mimeType.includes('json')
        ? buffer.toString('utf-8')
        : `[BINARY ${mimeType} ${buffer.length} bytes]`;

      const rawDoc = await LegalRawDocument.findOneAndUpdate(
        { documentId: discoveredDoc.id, versionNumber: 1 },
        {
          $set: {
            documentId: discoveredDoc.id,
            versionNumber: 1,
            title: discoveredDoc.title,
            sourceUrl: discoveredDoc.originalUrl,
            contentHash: sha256,
            mimeType,
            fileSize: buffer.length,
            rawText: rawTextPreview,
            rawBinaryBase64: buffer.toString('base64'),
          },
        },
        { upsert: true, returnDocument: 'after' }
      );

      const storageReference = `mongo:legal_raw_documents:${String(rawDoc._id)}`;

      await prisma.discoveredLegalDocument.update({
        where: { id: discoveredDoc.id },
        data: {
          sha256,
          mimeType,
          fileSize: buffer.length,
          downloadedAt: new Date(),
          downloadStatus: 'DOWNLOADED',
          storageReference,
          lastError: null,
        },
      });

      return {
        discoveredDocId: discoveredDoc.id,
        status: 'DOWNLOADED',
        buffer,
        mimeType,
        fileSize: buffer.length,
        sha256,
        storageReference,
      };
    } catch (err: any) {
      logger.warn(`[LegalDownloader] Failed ${discoveredDoc.originalUrl}: ${err.message}`);
      await prisma.discoveredLegalDocument.update({
        where: { id: discoveredDoc.id },
        data: {
          downloadStatus: 'FAILED',
          processingStatus: 'FAILED',
          lastError: err.message,
        },
      });
      return {
        discoveredDocId: discoveredDoc.id,
        status: 'FAILED',
        error: err.message,
      };
    }
  }
}

export const legalDocumentDownloader = new LegalDocumentDownloader();
export default legalDocumentDownloader;
