import { describe, it, expect } from 'vitest';
import { contentExtractorService } from '../../src/services/content-extractor.service';

describe('ContentExtractorService', () => {
  it('extracts metadata and cleans text from HTML', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>My Great Documentation</title>
          <meta name="description" content="A comprehensive guide to backend engineering">
          <link rel="canonical" href="https://example.com/canonical-doc">
        </head>
        <body>
          <header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
          <div class="cookie-banner">We use cookies to improve your experience. <button>Accept</button></div>
          <main>
            <h1>Getting Started</h1>
            <p>Welcome to the official developer guide. This page covers essential setup steps.</p>
            <h2>Prerequisites</h2>
            <p>Ensure you have Node.js 22 LTS installed on your system.</p>
          </main>
          <aside class="advert">Buy our product now!</aside>
          <footer><p>&copy; 2026 Company Inc.</p></footer>
          <script>console.log('tracking');</script>
        </body>
      </html>
    `;

    const extracted = contentExtractorService.extract(html, 'https://example.com/raw-doc');

    expect(extracted.title).toBe('My Great Documentation');
    expect(extracted.description).toBe('A comprehensive guide to backend engineering');
    expect(extracted.canonicalUrl).toBe('https://example.com/canonical-doc');
    expect(extracted.headings).toContain('Getting Started');
    expect(extracted.headings).toContain('Prerequisites');

    // Should contain main body content
    expect(extracted.content).toContain('Welcome to the official developer guide.');
    expect(extracted.content).toContain('Ensure you have Node.js 22 LTS installed');

    // Should NOT contain stripped elements
    expect(extracted.content).not.toContain('We use cookies');
    expect(extracted.content).not.toContain('Buy our product now');
    expect(extracted.content).not.toContain('Company Inc');
    expect(extracted.content).not.toContain('console.log');
  });

  it('falls back gracefully to article or body if main is absent', () => {
    const html = `
      <html>
        <head><title>Article Fallback</title></head>
        <body>
          <article>
            <h1>Article Heading</h1>
            <p>This is article text content that should be extracted cleanly.</p>
          </article>
        </body>
      </html>
    `;

    const extracted = contentExtractorService.extract(html, 'https://example.com/article');
    expect(extracted.title).toBe('Article Fallback');
    expect(extracted.content).toContain('This is article text content');
  });
});

