import { describe, it, expect, vi } from 'vitest';
import ssrfGuard, { SsrfGuard } from '../../src/lib/network/ssrf-guard';
import { ForbiddenError } from '../../src/lib/errors';
import dns from 'dns';

describe('SSRF Guard & Network Defense (Phase 5)', () => {
  const guard = new SsrfGuard();

  describe('isPrivateOrBlockedIpv4', () => {
    it('blocks loopback addresses (127.0.0.0/8)', () => {
      expect(guard.isPrivateOrBlockedIpv4('127.0.0.1')).toBe(true);
      expect(guard.isPrivateOrBlockedIpv4('127.255.255.255')).toBe(true);
    });

    it('blocks RFC 1918 private subnets', () => {
      // 10.0.0.0/8
      expect(guard.isPrivateOrBlockedIpv4('10.0.0.1')).toBe(true);
      expect(guard.isPrivateOrBlockedIpv4('10.254.1.99')).toBe(true);

      // 172.16.0.0/12
      expect(guard.isPrivateOrBlockedIpv4('172.16.0.1')).toBe(true);
      expect(guard.isPrivateOrBlockedIpv4('172.31.255.255')).toBe(true);
      expect(guard.isPrivateOrBlockedIpv4('172.32.0.1')).toBe(false); // Public

      // 192.168.0.0/16
      expect(guard.isPrivateOrBlockedIpv4('192.168.1.1')).toBe(true);
      expect(guard.isPrivateOrBlockedIpv4('192.168.254.254')).toBe(true);
    });

    it('blocks Cloud metadata and Link-Local (169.254.0.0/16)', () => {
      expect(guard.isPrivateOrBlockedIpv4('169.254.169.254')).toBe(true);
      expect(guard.isPrivateOrBlockedIpv4('169.254.1.1')).toBe(true);
    });

    it('blocks multicast, broadcast, and current network (0.0.0.0/8, 224.0.0.0/4, 240.0.0.0/4)', () => {
      expect(guard.isPrivateOrBlockedIpv4('0.0.0.0')).toBe(true);
      expect(guard.isPrivateOrBlockedIpv4('224.0.0.1')).toBe(true);
      expect(guard.isPrivateOrBlockedIpv4('240.0.0.1')).toBe(true);
      expect(guard.isPrivateOrBlockedIpv4('255.255.255.255')).toBe(true);
    });

    it('allows legitimate public IP addresses', () => {
      expect(guard.isPrivateOrBlockedIpv4('8.8.8.8')).toBe(false);
      expect(guard.isPrivateOrBlockedIpv4('1.1.1.1')).toBe(false);
      expect(guard.isPrivateOrBlockedIpv4('93.184.216.34')).toBe(false);
    });
  });

  describe('isPrivateOrBlockedIpv6', () => {
    it('blocks IPv6 loopback (::1)', () => {
      expect(guard.isPrivateOrBlockedIpv6('::1')).toBe(true);
      expect(guard.isPrivateOrBlockedIpv6('0:0:0:0:0:0:0:1')).toBe(true);
    });

    it('blocks IPv6 link-local and unique-local (fe80::, fc00::, fd00::)', () => {
      expect(guard.isPrivateOrBlockedIpv6('fe80::1')).toBe(true);
      expect(guard.isPrivateOrBlockedIpv6('fc00::1')).toBe(true);
      expect(guard.isPrivateOrBlockedIpv6('fd12:3456:789a::1')).toBe(true);
    });

    it('blocks IPv4-mapped IPv6 pointing to private IPv4', () => {
      expect(guard.isPrivateOrBlockedIpv6('::ffff:127.0.0.1')).toBe(true);
      expect(guard.isPrivateOrBlockedIpv6('::ffff:169.254.169.254')).toBe(true);
      expect(guard.isPrivateOrBlockedIpv6('::ffff:192.168.1.1')).toBe(true);
      expect(guard.isPrivateOrBlockedIpv6('::ffff:8.8.8.8')).toBe(false);
    });
  });

  describe('validateUrl & assertSafeUrl', () => {
    it('rejects unsupported protocols (file, ftp, gopher)', async () => {
      const resFile = await guard.validateUrl('file:///etc/passwd');
      expect(resFile.isValid).toBe(false);
      expect(resFile.reason).toContain('Forbidden protocol');

      const resFtp = await guard.validateUrl('ftp://ftp.example.com/file');
      expect(resFtp.isValid).toBe(false);
    });

    it('rejects forbidden hostnames (localhost, metadata.google.internal)', async () => {
      const resLocal = await guard.validateUrl('http://localhost:8080/mcp');
      expect(resLocal.isValid).toBe(false);
      expect(resLocal.reason).toContain('forbidden by SSRF');

      const resMeta = await guard.validateUrl('http://metadata.google.internal/computeMetadata/v1');
      expect(resMeta.isValid).toBe(false);
    });

    it('rejects direct private IP URLs with ForbiddenError in assertSafeUrl', async () => {
      await expect(guard.assertSafeUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
        ForbiddenError
      );
      await expect(guard.assertSafeUrl('http://127.0.0.1:3000/mcp')).rejects.toThrow(ForbiddenError);
      await expect(guard.assertSafeUrl('http://10.0.0.5:8080')).rejects.toThrow(ForbiddenError);
    });

    it('resolves and accepts safe public URLs', async () => {
      // Mock DNS lookup to return public IP
      vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);

      const validated = await guard.assertSafeUrl('https://mcp.slack.com/mcp');
      expect(validated).toBe('https://mcp.slack.com/mcp');
    });

    it('rejects hostnames that resolve to private subnets (DNS rebinding)', async () => {
      // Hostname looks like benign domain but resolves to internal IP
      vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as any);

      await expect(guard.assertSafeUrl('https://evil-internal-rebinder.com/mcp')).rejects.toThrow(
        ForbiddenError
      );
    });
  });

  describe('createSafeLookup (Socket-Level Pinning)', () => {
    it('blocks DNS resolution when resolved IP is in private subnet', () => {
      const lookup = guard.createSafeLookup();

      vi.spyOn(dns, 'lookup').mockImplementation((_host: any, _opts: any, cb: any) => {
        cb(null, [{ address: '169.254.169.254', family: 4 }]);
      });

      lookup('cloud-metadata-spoof.internal', {} as any, (err, _address) => {
        expect(err).toBeDefined();
        expect(err?.message).toContain('SSRF Guard: DNS rebinding blocked');
      });
    });

    it('allows DNS resolution when resolved IP is public', () => {
      const lookup = guard.createSafeLookup();

      vi.spyOn(dns, 'lookup').mockImplementation((_host: any, _opts: any, cb: any) => {
        cb(null, [{ address: '93.184.216.34', family: 4 }]);
      });

      lookup('safe-domain.org', {} as any, (err, address) => {
        expect(err).toBeNull();
        expect(address).toBeDefined();
      });
    });
  });
});
