import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SitemapService } from '../../src/services/sitemap.service';

describe('SitemapService', () => {
  let sitemapService: SitemapService;

  beforeEach(() => {
    sitemapService = new SitemapService();
  });

  it('parses standard <urlset> sitemaps and extracts URLs', async () => {
    const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url>
          <loc>https://example.com/page-1</loc>
          <lastmod>2026-11-01</lastmod>
          <changefreq>weekly</changefreq>
          <priority>0.8</priority>
        </url>
        <url>
          <loc>https://example.com/page-2</loc>
          <lastmod>2026-11-02</lastmod>
        </url>
      </urlset>
    `;

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => mockXml,
    } as any);

    const results = await sitemapService.fetchAndParse('https://example.com/sitemap.xml', {
      allowedHosts: ['example.com'],
    });

    expect(results).toHaveLength(2);
    expect(results[0].url).toBe('https://example.com/page-1');
    expect(results[0].lastmod).toBe('2026-11-01');
    expect(results[0].priority).toBe(0.8);
    expect(results[1].url).toBe('https://example.com/page-2');
  });

  it('handles nested <sitemapindex> recursively', async () => {
    const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap>
          <loc>https://example.com/sitemap-sub.xml</loc>
        </sitemap>
      </sitemapindex>
    `;

    const subXml = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url>
          <loc>https://example.com/sub-page-1</loc>
        </url>
      </urlset>
    `;

    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => indexXml,
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => subXml,
      } as any);

    const results = await sitemapService.fetchAndParse('https://example.com/sitemap-index.xml', {
      allowedHosts: ['example.com'],
    });

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://example.com/sub-page-1');
  });

  it('enforces maxPages limit during parsing', async () => {
    const urlsXml = Array.from({ length: 50 }, (_, i) => `<url><loc>https://example.com/page-${i}</loc></url>`).join('');
    const mockXml = `<urlset>${urlsXml}</urlset>`;

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => mockXml,
    } as any);

    const results = await sitemapService.fetchAndParse('https://example.com/sitemap.xml', {
      allowedHosts: ['example.com'],
      maxPages: 5,
    });

    expect(results).toHaveLength(5);
  });
});

