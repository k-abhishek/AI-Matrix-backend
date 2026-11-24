import { SSRError } from '../lib/errors';

const PRIVATE_IP_REGEXES = [
  /^127\./, // 127.0.0.0/8
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // 169.254.0.0/16 (Link Local)
  /^0\./, // 0.0.0.0/8
  /^::1$/, // IPv6 localhost
  /^[fF][cCdD]/, // Unique local address (fc00::/7)
  /^[fF][eE][89aAbB]/, // Link local address (fe80::/10)
];

const FORBIDDEN_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  '169.254.169.254',
  'instance-data',
]);

/**
 * Validates a URL against protocol and SSRF constraints.
 * Throws SSRError if the URL is invalid or targets a private address.
 */
export function validateSafeUrl(rawUrl: string, allowedHosts?: string[]): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SSRError(`Invalid URL format: ${rawUrl}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SSRError(`Disallowed protocol: ${url.protocol}. Only HTTP and HTTPS are permitted.`);
  }

  const hostname = url.hostname.toLowerCase();

  if (
    FORBIDDEN_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new SSRError(`Host '${hostname}' is prohibited (private or internal host)`);
  }

  for (const regex of PRIVATE_IP_REGEXES) {
    if (regex.test(hostname)) {
      throw new SSRError(`IP destination '${hostname}' is private/link-local and prohibited`);
    }
  }

  if (allowedHosts && allowedHosts.length > 0) {
    const isAllowed = allowedHosts.some((allowed) => {
      const lower = allowed.toLowerCase().trim();
      return hostname === lower || hostname.endsWith(`.${lower}`);
    });
    if (!isAllowed) {
      throw new SSRError(`Host '${hostname}' is not in the allowed hosts list: [${allowedHosts.join(', ')}]`);
    }
  }

  return url;
}

/**
 * Normalizes a URL: removes hashes, removes tracking parameters, normalizes slashes.
 */
export function normalizeUrl(rawUrl: string, baseUrl?: string): string | null {
  try {
    const url = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    url.hash = '';

    // Strip common tracking and session query parameters
    const paramsToDelete: string[] = [];
    url.searchParams.forEach((_, key) => {
      const lower = key.toLowerCase();
      if (
        lower.startsWith('utm_') ||
        lower === 'ref' ||
        lower === 'fbclid' ||
        lower === 'gclid' ||
        lower === 'msclkid' ||
        lower === 'mc_cid' ||
        lower === 'mc_eid' ||
        lower === '_ga'
      ) {
        paramsToDelete.push(key);
      }
    });
    paramsToDelete.forEach((key) => url.searchParams.delete(key));

    // Remove trailing slash on root or general paths if path is just '/'
    let normalized = url.href;
    if (url.pathname === '/' && !url.search) {
      normalized = url.origin;
    }

    return normalized;
  } catch {
    return null;
  }
}

/**
 * Checks if a URL matches inclusion and exclusion patterns.
 * Patterns can be simple prefixes or wildcard/regex strings.
 */
export function matchesPatterns(
  url: string,
  includePatterns: string[] = [],
  excludePatterns: string[] = []
): boolean {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // Keep as is
  }

  // Check exclusions first
  for (const pattern of excludePatterns) {
    if (matchesPattern(url, pathname, pattern)) {
      return false;
    }
  }

  // If inclusions are specified, URL must match at least one
  if (includePatterns.length > 0) {
    return includePatterns.some((pattern) => matchesPattern(url, pathname, pattern));
  }

  return true;
}

function matchesPattern(targetUrl: string, targetPath: string, pattern: string): boolean {
  if (!pattern) return false;
  const trimmed = pattern.trim();
  if (trimmed === '*' || trimmed === '') return true;

  // If pattern starts with /, test against pathname as well as full URL
  const testStrings = trimmed.startsWith('/') ? [targetPath, targetUrl] : [targetUrl, targetPath];

  // If pattern starts and ends with /, treat as RegExp
  if (trimmed.startsWith('/') && trimmed.endsWith('/') && trimmed.length > 2) {
    try {
      const regex = new RegExp(trimmed.slice(1, -1));
      return testStrings.some((s) => regex.test(s));
    } catch {
      // Fallback
    }
  }

  // Wildcard conversion: replace * with .*
  if (trimmed.includes('*')) {
    const escaped = trimmed.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    try {
      const regex = new RegExp(`^${escaped}$`, 'i');
      if (testStrings.some((s) => regex.test(s))) return true;
    } catch {
      // Fallback
    }
  }

  // Substring or prefix check
  return testStrings.some((s) => s.includes(trimmed));
}
