export interface SitemapEntry {
  url: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
}

export interface ParseSitemapOptions {
  allowedHosts?: string[];
  includePatterns?: string[];
  excludePatterns?: string[];
  maxPages?: number;
  timeoutMs?: number;
}

