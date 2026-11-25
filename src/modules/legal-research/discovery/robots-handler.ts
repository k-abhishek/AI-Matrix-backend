import { validateSafeUrl } from '../../../utils/url';
import logger from '../../../lib/logger';

export interface RobotsPolicy {
  disallowedPaths: string[];
  crawlDelayMs?: number;
  sitemaps: string[];
}

export class RobotsHandler {
  private cache = new Map<string, RobotsPolicy>();

  async getPolicy(baseUrl: string, allowedHosts: string[] = []): Promise<RobotsPolicy> {
    const parsed = new URL(baseUrl);
    const origin = parsed.origin;
    const cached = this.cache.get(origin);
    if (cached) return cached;

    const robotsUrl = `${origin}/robots.txt`;
    const policy: RobotsPolicy = { disallowedPaths: [], sitemaps: [] };

    try {
      validateSafeUrl(robotsUrl, allowedHosts);
      const res = await fetch(robotsUrl, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'AIMatrixLegalIngestor/1.0' },
      });
      if (!res.ok) {
        this.cache.set(origin, policy);
        return policy;
      }

      const text = await res.text();
      let inWildcardSection = false;
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.split('#')[0].trim();
        if (!line) continue;

        const lower = line.toLowerCase();
        if (lower.startsWith('user-agent:')) {
          const agent = line.slice('user-agent:'.length).trim();
          inWildcardSection = agent === '*';
        } else if (lower.startsWith('sitemap:')) {
          const sm = line.slice('sitemap:'.length).trim();
          if (sm) policy.sitemaps.push(sm);
        } else if (inWildcardSection && lower.startsWith('disallow:')) {
          const p = line.slice('disallow:'.length).trim();
          if (p) policy.disallowedPaths.push(p);
        } else if (inWildcardSection && lower.startsWith('crawl-delay:')) {
          const sec = Number.parseFloat(line.slice('crawl-delay:'.length).trim());
          if (!Number.isNaN(sec) && sec > 0) {
            policy.crawlDelayMs = Math.min(10000, Math.round(sec * 1000));
          }
        }
      }
    } catch (err: any) {
      logger.debug(`[RobotsHandler] Could not fetch robots.txt at ${robotsUrl}: ${err.message}`);
    }

    this.cache.set(origin, policy);
    return policy;
  }

  isAllowed(targetUrl: string, policy: RobotsPolicy): boolean {
    try {
      const pathname = new URL(targetUrl).pathname;
      return !policy.disallowedPaths.some((dis) => dis === '/' || pathname.startsWith(dis));
    } catch {
      return false;
    }
  }
}

export const robotsHandler = new RobotsHandler();
export default robotsHandler;
