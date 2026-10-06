import { isIP } from 'node:net';
import { SandboxSecurityViolationError } from './errors.js';

export class SsrfGuard {
  private static readonly PROHIBITED_HOST_PATTERNS = [
    /^localhost$/i,
    /\.local$/i,
    /\.localhost$/i,
    /\.internal$/i,
    /\.corp$/i,
    /\.lan$/i,
    /\.svc\.cluster\.local$/i,
    /^kubernetes\.default$/i,
    /^metadata\.google\.internal$/i,
    /^169\.254\.169\.254$/,
  ];

  public static isIpProhibited(ip: string): boolean {
    const version = isIP(ip);
    if (version === 4) {
      return SsrfGuard.isIpv4Prohibited(ip);
    }
    if (version === 6) {
      return SsrfGuard.isIpv6Prohibited(ip);
    }
    return false;
  }

  public static isIpv4Prohibited(ip: string): boolean {
    const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
      return true;
    }

    const [b0, b1] = parts as [number, number, number, number];

    // 0.0.0.0/8 (current network)
    if (b0 === 0) return true;

    // 127.0.0.0/8 (loopback)
    if (b0 === 127) return true;

    // 10.0.0.0/8 (RFC 1918)
    if (b0 === 10) return true;

    // 172.16.0.0/12 (RFC 1918: 172.16.0.0 - 172.31.255.255)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

    // 192.168.0.0/16 (RFC 1918)
    if (b0 === 192 && b1 === 168) return true;

    // 169.254.0.0/16 (Link-Local / AWS/GCP/Azure instance metadata)
    if (b0 === 169 && b1 === 254) return true;

    // 100.64.0.0/10 (Carrier-grade NAT)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;

    // 192.0.2.0/24 (TEST-NET-1)
    if (b0 === 192 && b1 === 0 && parts[2] === 2) return true;

    // 198.51.100.0/24 (TEST-NET-2)
    if (b0 === 198 && b1 === 51 && parts[2] === 100) return true;

    // 203.0.113.0/24 (TEST-NET-3)
    if (b0 === 203 && b1 === 0 && parts[2] === 113) return true;

    // 224.0.0.0/4 (Multicast)
    if (b0 >= 224 && b0 <= 239) return true;

    // 240.0.0.0/4 (Reserved)
    if (b0 >= 240) return true;

    // 255.255.255.255 (Broadcast)
    if (b0 === 255 && b1 === 255 && parts[2] === 255 && parts[3] === 255) return true;

    return false;
  }

  public static isIpv6Prohibited(ip: string): boolean {
    const normalized = ip.toLowerCase();
    // Loopback
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
    // Unspecified
    if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;
    // Link-local fe80::/10
    if (
      normalized.startsWith('fe80:') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    )
      return true;
    // Unique local fc00::/7 (fc00:: and fd00::)
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    // IPv4-mapped IPv6 (::ffff:127.0.0.1, etc.)
    if (normalized.startsWith('::ffff:')) {
      const v4Part = normalized.replace('::ffff:', '');
      return SsrfGuard.isIpv4Prohibited(v4Part);
    }
    return false;
  }

  public static validateUrl(targetUrl: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      throw new SandboxSecurityViolationError(`Invalid URL provided: '${targetUrl}'`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new SandboxSecurityViolationError(
        `Disallowed URL protocol '${parsed.protocol}'. Only http: and https: are allowed.`,
      );
    }

    const hostname = parsed.hostname.toLowerCase();

    // Check prohibited hostname patterns
    for (const pattern of SsrfGuard.PROHIBITED_HOST_PATTERNS) {
      if (pattern.test(hostname)) {
        throw new SandboxSecurityViolationError(
          `SSRF Violation: Target host '${hostname}' is prohibited.`,
        );
      }
    }

    // If hostname is directly an IP, validate it
    if (isIP(hostname)) {
      if (SsrfGuard.isIpProhibited(hostname)) {
        throw new SandboxSecurityViolationError(
          `SSRF Violation: Target IP address '${hostname}' is within a prohibited private or link-local range.`,
        );
      }
    }

    return parsed;
  }
}
