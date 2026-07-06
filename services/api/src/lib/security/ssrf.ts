import { promises as dns } from "node:dns";
import { isIPv4, isIPv6 } from "node:net";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

function ipv4ToInt(ip: string): number {
  return ip
    .split(".")
    .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

const BLOCKED_V4: Array<{ base: number; bits: number }> = [
  { base: ipv4ToInt("0.0.0.0"), bits: 8 },
  { base: ipv4ToInt("10.0.0.0"), bits: 8 },
  { base: ipv4ToInt("100.64.0.0"), bits: 10 },
  { base: ipv4ToInt("127.0.0.0"), bits: 8 },
  { base: ipv4ToInt("169.254.0.0"), bits: 16 }, // link-local / AWS metadata
  { base: ipv4ToInt("172.16.0.0"), bits: 12 },
  { base: ipv4ToInt("192.0.0.0"), bits: 24 },
  { base: ipv4ToInt("192.168.0.0"), bits: 16 },
  { base: ipv4ToInt("198.18.0.0"), bits: 15 },
  { base: ipv4ToInt("198.51.100.0"), bits: 24 },
  { base: ipv4ToInt("203.0.113.0"), bits: 24 },
  { base: ipv4ToInt("240.0.0.0"), bits: 4 },
  { base: ipv4ToInt("255.255.255.255"), bits: 32 },
];

function isBlockedIPv4(ip: string): boolean {
  const addr = ipv4ToInt(ip);
  return BLOCKED_V4.some(({ base, bits }) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (addr & mask) === (base & mask);
  });
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  // loopback
  if (lower === "::1") return true;
  // unique-local fc00::/7
  if (/^f[cd]/i.test(lower)) return true;
  // link-local fe80::/10
  if (lower.startsWith("fe80")) return true;
  // IPv4-mapped ::ffff:
  if (lower.startsWith("::ffff:")) return true;
  return false;
}

export async function assertSafeHost(hostname: string): Promise<void> {
  const bare = hostname.replace(/^\[|\]$/g, "");

  if (isIPv4(bare)) {
    if (isBlockedIPv4(bare)) throw new SsrfError(`Blocked IP: ${bare}`);
    return;
  }

  if (isIPv6(bare)) {
    if (isBlockedIPv6(bare)) throw new SsrfError(`Blocked IPv6: ${bare}`);
    return;
  }

  // Resolve DNS and check every returned address
  const resolved: string[] = [];
  const [v4, v6] = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname),
  ]);
  if (v4.status === "fulfilled") resolved.push(...v4.value);
  if (v6.status === "fulfilled") resolved.push(...v6.value);

  for (const addr of resolved) {
    if (isIPv4(addr) && isBlockedIPv4(addr)) {
      throw new SsrfError(`${hostname} resolves to blocked IP: ${addr}`);
    }
    if (isIPv6(addr) && isBlockedIPv6(addr)) {
      throw new SsrfError(`${hostname} resolves to blocked IPv6: ${addr}`);
    }
  }
}
