import { describe, it, expect } from 'vitest';
import { validateSafeUrl, normalizeUrl, matchesPatterns } from '../../src/utils/url';
import { SSRError } from '../../src/lib/errors';

describe('URL Utils & SSRF Protection', () => {
  it('allows valid public HTTP and HTTPS URLs', () => {
    const url1 = validateSafeUrl('https://example.com/docs');
    expect(url1.hostname).toBe('example.com');

    const url2 = validateSafeUrl('http://my-blog.org/articles/1');
    expect(url2.hostname).toBe('my-blog.org');
  });

  it('rejects disallowed protocols like file:, ftp:, javascript:', () => {
    expect(() => validateSafeUrl('file:///etc/passwd')).toThrow(SSRError);
    expect(() => validateSafeUrl('ftp://example.com/file')).toThrow(SSRError);
    expect(() => validateSafeUrl('javascript:alert(1)')).toThrow(SSRError);
  });

  it('blocks private IPv4 and loopback addresses', () => {
    expect(() => validateSafeUrl('http://localhost:8080')).toThrow(SSRError);
    expect(() => validateSafeUrl('http://127.0.0.1/admin')).toThrow(SSRError);
    expect(() => validateSafeUrl('http://10.0.0.5/api')).toThrow(SSRError);
    expect(() => validateSafeUrl('http://192.168.1.100')).toThrow(SSRError);
    expect(() => validateSafeUrl('http://172.20.0.1')).toThrow(SSRError);
    expect(() => validateSafeUrl('http://169.254.169.254/latest/meta-data')).toThrow(SSRError);
  });

  it('blocks internal hostnames', () => {
    expect(() => validateSafeUrl('http://metadata.google.internal')).toThrow(SSRError);
    expect(() => validateSafeUrl('http://service.localhost')).toThrow(SSRError);
    expect(() => validateSafeUrl('http://app.internal')).toThrow(SSRError);
  });

  it('enforces allowedHosts when provided', () => {
    const allowed = ['example.com', 'docs.example.com'];
    expect(() => validateSafeUrl('https://example.com/page', allowed)).not.toThrow();
    expect(() => validateSafeUrl('https://sub.docs.example.com/page', allowed)).not.toThrow();
    expect(() => validateSafeUrl('https://attacker.com/page', allowed)).toThrow(SSRError);
  });

  it('normalizes URLs and strips tracking parameters', () => {
    const raw = 'https://example.com/docs/intro?utm_source=twitter&utm_medium=social&ref=home#section1';
    const normalized = normalizeUrl(raw);
    expect(normalized).toBe('https://example.com/docs/intro');
  });

  it('resolves relative URLs against baseUrl', () => {
    const normalized = normalizeUrl('/guides/setup', 'https://example.com/docs/');
    expect(normalized).toBe('https://example.com/guides/setup');
  });

  it('correctly matches inclusion and exclusion patterns', () => {
    const url = 'https://example.com/docs/guide';

    // Inclusions
    expect(matchesPatterns(url, ['/docs/*'])).toBe(true);
    expect(matchesPatterns(url, ['/blog/*'])).toBe(false);

    // Exclusions
    expect(matchesPatterns(url, ['/docs/*'], ['*guide*'])).toBe(false);
    expect(matchesPatterns(url, ['/docs/*'], ['*changelog*'])).toBe(true);
  });
});

