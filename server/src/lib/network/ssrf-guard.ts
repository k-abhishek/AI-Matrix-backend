import dns from 'dns';
import net from 'net';
import { BadRequestError, ForbiddenError } from '../errors';
import logger from '../logger';

export interface SsrfValidationResult {
  isValid: boolean;
  reason?: string;
  resolvedIps?: string[];
}

export class SsrfGuard {
  private readonly blockedHostnames = new Set([
    'localhost',
    'metadata.google.internal',
    'metadata.goog',
    'instance-data',
  ]);

  /**
   * Checks whether a given IPv4 string falls into private, loopback, link-local, or reserved ranges.
   */
  isPrivateOrBlockedIpv4(ip: string): boolean {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true; // Malformed IPv4 is treated as blocked
    }

    const [a, b, c] = parts;

    // 0.0.0.0/8 (Current network / default route)
    if (a === 0) return true;

    // 10.0.0.0/8 (Private-Use RFC 1918)
    if (a === 10) return true;

    // 100.64.0.0/10 (Shared Address Space / CGNAT RFC 6598)
    if (a === 100 && b >= 64 && b <= 127) return true;

    // 127.0.0.0/8 (Loopback RFC 1122)
    if (a === 127) return true;

    // 169.254.0.0/16 (Link-Local RFC 3927 & AWS/GCP/Azure Metadata)
    if (a === 169 && b === 254) return true;

    // 172.16.0.0/12 (Private-Use RFC 1918: 172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (a === 192 && b === 0 && c === 0) return true;

    // 192.0.2.0/24 (TEST-NET-1 RFC 5737)
    if (a === 192 && b === 0 && c === 2) return true;

    // 192.168.0.0/16 (Private-Use RFC 1918)
    if (a === 192 && b === 168) return true;

    // 198.18.0.0/15 (Network Benchmark Tests RFC 2544)
    if (a === 198 && (b === 18 || b === 19)) return true;

    // 198.51.100.0/24 (TEST-NET-2 RFC 5737)
    if (a === 198 && b === 51 && c === 100) return true;

    // 203.0.113.0/24 (TEST-NET-3 RFC 5737)
    if (a === 203 && b === 0 && c === 113) return true;

    // 224.0.0.0/4 (Multicast RFC 5771: 224.0.0.0 - 239.255.255.255)
    if (a >= 224 && a <= 239) return true;

    // 240.0.0.0/4 (Reserved RFC 1112: 240.0.0.0 - 255.255.255.255)
    if (a >= 240) return true;

    return false;
  }

  /**
   * Checks whether a given IPv6 string falls into loopback, unique-local, link-local, or multicast ranges.
   */
  isPrivateOrBlockedIpv6(ip: string): boolean {
    const normalized = ip.toLowerCase().trim();

    // Loopback
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;

    // Unspecified
    if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;

    // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
    if (normalized.startsWith('::ffff:')) {
      const remainder = normalized.replace('::ffff:', '');
      if (net.isIPv4(remainder)) {
        return this.isPrivateOrBlockedIpv4(remainder);
      }
    }

    // Unique Local Address (fc00::/7 -> fc00 to fdff)
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

    // Link-Local (fe80::/10 -> fe80 to febf)
    if (/^fe[89ab]/i.test(normalized)) return true;

    // Multicast (ff00::/8)
    if (normalized.startsWith('ff')) return true;

    // Discard prefix / Documentation (2001:db8::/32)
    if (normalized.startsWith('2001:db8')) return true;

    return false;
  }

  /**
   * Checks if an IP address (IPv4 or IPv6) is blocked.
   */
  isBlockedIp(ip: string): boolean {
    const family = net.isIP(ip);
    if (family === 4) {
      return this.isPrivateOrBlockedIpv4(ip);
    }
    if (family === 6) {
      return this.isPrivateOrBlockedIpv6(ip);
    }
    // Not a valid IP
    return true;
  }

  /**
   * Validates a URL and resolves its host to ensure it does not target private or restricted networks.
   */
  async validateUrl(rawUrl: string): Promise<SsrfValidationResult> {
    if (!rawUrl || typeof rawUrl !== 'string') {
      return { isValid: false, reason: 'URL must be a non-empty string' };
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      return { isValid: false, reason: 'Malformed URL format' };
    }

    // Only HTTP and HTTPS protocols are permitted
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        isValid: false,
        reason: `Forbidden protocol '${parsed.protocol}'. Only http: and https: are allowed.`,
      };
    }

    const hostname = parsed.hostname.toLowerCase().trim();

    // Check blocked hostnames
    if (this.blockedHostnames.has(hostname) || hostname.endsWith('.localhost')) {
      return {
        isValid: false,
        reason: `Target hostname '${hostname}' is forbidden by SSRF protection policy.`,
      };
    }

    // Direct IP literal in URL
    if (net.isIP(hostname)) {
      if (this.isBlockedIp(hostname)) {
        return {
          isValid: false,
          reason: `Target IP address '${hostname}' belongs to a private, loopback, or reserved subnet.`,
          resolvedIps: [hostname],
        };
      }
      return { isValid: true, resolvedIps: [hostname] };
    }

    // Resolve DNS records (both IPv4 and IPv6)
    try {
      const records = await dns.promises.lookup(hostname, { all: true });
      if (!records || records.length === 0) {
        return { isValid: false, reason: `Could not resolve hostname '${hostname}'.` };
      }

      const resolvedIps = records.map((r) => r.address);

      for (const record of records) {
        if (this.isBlockedIp(record.address)) {
          logger.warn(
            `[SsrfGuard] Blocked DNS resolution for host '${hostname}' -> IP '${record.address}'`
          );
          return {
            isValid: false,
            reason: `Hostname '${hostname}' resolved to private/forbidden IP address '${record.address}'.`,
            resolvedIps,
          };
        }
      }

      return { isValid: true, resolvedIps };
    } catch (err: any) {
      return {
        isValid: false,
        reason: `DNS lookup failed for '${hostname}': ${err.message}`,
      };
    }
  }

  /**
   * Asserts that a URL is safe. Throws ForbiddenError or BadRequestError if blocked.
   */
  async assertSafeUrl(rawUrl: string): Promise<string> {
    const result = await this.validateUrl(rawUrl);
    if (!result.isValid) {
      throw new ForbiddenError(result.reason || 'Target URL blocked by SSRF protection policy');
    }
    return rawUrl.trim();
  }

  /**
   * Custom DNS lookup function designed for Node.js http.Agent / undici to prevent
   * DNS Rebinding (TOCTOU) attacks at socket creation time.
   */
  createSafeLookup() {
    return (
      hostname: string,
      options: dns.LookupOptions,
      callback: (err: NodeJS.ErrnoException | null, address: any, family?: number) => void
    ) => {
      dns.lookup(hostname, options as any, (err, address, family) => {
        if (err) {
          return callback(err, address, family);
        }

        const addresses = Array.isArray(address) ? address : [{ address, family }];
        for (const entry of addresses) {
          const ip = typeof entry === 'string' ? entry : entry.address;
          if (this.isBlockedIp(ip)) {
            const ssrfErr = new Error(
              `SSRF Guard: DNS rebinding blocked. IP '${ip}' is in a reserved subnet.`
            );
            (ssrfErr as any).code = 'ERR_SSRF_BLOCKED';
            return callback(ssrfErr as any, null, family);
          }
        }

        return callback(null, address, family);
      });
    };
  }
}

export const ssrfGuard = new SsrfGuard();
export default ssrfGuard;
