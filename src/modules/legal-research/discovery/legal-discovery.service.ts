import prisma from '../../../lib/prisma';
import logger from '../../../lib/logger';
import sitemapService from '../../../services/sitemap.service';
import { normalizeUrl, validateSafeUrl } from '../../../utils/url';
import robotsHandler from './robots-handler';
import legalLinkExtractor from './link-extractor';

export interface SourceDiscoveryResult {
  sourceId: string;
  sourceName: string;
  discoveredCount: number;
  skippedRestrictions: string[];
  errors: string[];
}

export class LegalDiscoveryService {
  private detectAccessRestriction(html: string, status: number): string | null {
    if (status === 401 || status === 403) {
      return `HTTP ${status} access restriction`;
    }
    const lower = html.toLowerCase();
    if (
      lower.includes('captcha') ||
      lower.includes('cf-browser-verification') ||
      lower.includes('verify you are human')
    ) {
      return 'CAPTCHA / anti-bot gate detected (skipped without bypassing)';
    }
    if (
      lower.includes('<div id="root"></div>') ||
      lower.includes('enable javascript to run this app')
    ) {
      return 'JavaScript-rendered SPA detected with no static HTML links';
    }
    return null;
  }

  async discoverForSource(
    source: {
      id: string;
      name: string;
      baseUrl: string;
      crawlConfig: any;
    },
    options: { dryRun?: boolean; limit?: number } = {}
  ): Promise<SourceDiscoveryResult> {
    const cfg = (source.crawlConfig || {}) as {
      allowedHosts?: string[];
      seedPaths?: string[];
      includePatterns?: string[];
      excludePatterns?: string[];
      maxDepth?: number;
      maxPages?: number;
      delayMs?: number;
      timeoutMs?: number;
    };

    const allowedHosts = cfg.allowedHosts || [new URL(source.baseUrl).hostname];
    const maxPages = Math.min(options.limit ?? cfg.maxPages ?? 30, cfg.maxPages ?? 30);
    const maxDepth = cfg.maxDepth ?? 2;
    const delayMs = cfg.delayMs ?? 800;
    const timeoutMs = cfg.timeoutMs ?? 12000;

    const skippedRestrictions: string[] = [];
    const errors: string[] = [];
    const discoveredMap = new Map<
      string,
      { title: string; originalUrl: string; canonicalUrl: string; fileType: string }
    >();

    const policy = await robotsHandler.getPolicy(source.baseUrl, allowedHosts);
    const effectiveDelay = Math.max(delayMs, policy.crawlDelayMs ?? 0);

    // 1. Try sitemaps from robots.txt or /sitemap.xml
    const sitemapCandidates = [
      ...policy.sitemaps,
      `${new URL(source.baseUrl).origin}/sitemap.xml`,
    ];
    for (const smUrl of [...new Set(sitemapCandidates)]) {
      if (discoveredMap.size >= maxPages) break;
      try {
        const entries = await sitemapService.fetchAndParse(smUrl, {
          allowedHosts,
          includePatterns: cfg.includePatterns,
          excludePatterns: cfg.excludePatterns,
          maxPages: maxPages - discoveredMap.size,
          timeoutMs,
        });
        for (const e of entries) {
          if (!robotsHandler.isAllowed(e.url, policy)) continue;
          const fileType = legalLinkExtractor.inferFileType(e.url);
          discoveredMap.set(e.url, {
            title: e.url.split('/').pop() || e.url,
            originalUrl: e.url,
            canonicalUrl: e.url,
            fileType,
          });
        }
      } catch (err: any) {
        logger.debug(`[LegalDiscovery] Sitemap unavailable for ${smUrl}: ${err.message}`);
      }
    }

    // 2. Polite BFS HTML crawl from seedPaths
    const queue: Array<{ url: string; depth: number }> = [];
    const visitedPages = new Set<string>();
    const origin = new URL(source.baseUrl).origin;

    for (const sp of cfg.seedPaths || ['/']) {
      const full = normalizeUrl(sp, source.baseUrl) || `${origin}${sp}`;
      queue.push({ url: full, depth: 0 });
    }

    while (queue.length > 0 && visitedPages.size < maxPages && discoveredMap.size < maxPages) {
      const next = queue.shift()!;
      if (visitedPages.has(next.url) || next.depth > maxDepth) continue;
      if (!robotsHandler.isAllowed(next.url, policy)) {
        skippedRestrictions.push(`robots.txt disallowed: ${next.url}`);
        continue;
      }

      visitedPages.add(next.url);

      if (effectiveDelay > 0 && visitedPages.size > 1) {
        await new Promise((r) => setTimeout(r, Math.min(effectiveDelay, 1500)));
      }

      try {
        validateSafeUrl(next.url, allowedHosts);
        const res = await fetch(next.url, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            'User-Agent': 'AIMatrixLegalIngestor/1.0 (+official-public-legal-research)',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });

        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/pdf')) {
          discoveredMap.set(next.url, {
            title: next.url.split('/').pop() || next.url,
            originalUrl: next.url,
            canonicalUrl: next.url,
            fileType: 'PDF',
          });
          continue;
        }

        const html = await res.text();
        const restriction = this.detectAccessRestriction(html, res.status);
        if (restriction) {
          skippedRestrictions.push(`${next.url}: ${restriction}`);
          continue;
        }
        if (!res.ok) {
          errors.push(`${next.url}: HTTP ${res.status}`);
          continue;
        }

        const links = legalLinkExtractor.extractLinks(
          html,
          next.url,
          allowedHosts,
          cfg.excludePatterns
        );

        for (const link of links) {
          if (discoveredMap.size >= maxPages) break;
          if (!robotsHandler.isAllowed(link.canonicalUrl, policy)) continue;

          if (link.isDocumentCandidate) {
            discoveredMap.set(link.canonicalUrl, {
              title: link.title,
              originalUrl: link.url,
              canonicalUrl: link.canonicalUrl,
              fileType: link.fileType,
            });
          }

          if (link.fileType === 'HTML' && next.depth + 1 <= maxDepth && !visitedPages.has(link.url)) {
            queue.push({ url: link.url, depth: next.depth + 1 });
          }
        }
      } catch (err: any) {
        errors.push(`${next.url}: ${err.message}`);
      }
    }

    if (!options.dryRun) {
      for (const item of discoveredMap.values()) {
        await prisma.discoveredLegalDocument.upsert({
          where: { canonicalUrl: item.canonicalUrl },
          update: {
            title: item.title,
            fileType: item.fileType,
          },
          create: {
            knowledgeSourceId: source.id,
            title: item.title,
            originalUrl: item.originalUrl,
            canonicalUrl: item.canonicalUrl,
            fileType: item.fileType,
            downloadStatus: 'PENDING',
            processingStatus: 'PENDING',
          },
        });
      }
    }

    return {
      sourceId: source.id,
      sourceName: source.name,
      discoveredCount: discoveredMap.size,
      skippedRestrictions,
      errors,
    };
  }
}

export const legalDiscoveryService = new LegalDiscoveryService();
export default legalDiscoveryService;
