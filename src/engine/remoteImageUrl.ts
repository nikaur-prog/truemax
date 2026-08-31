function privateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second, third] = parts;
  return first === 0
    || first === 10
    || first === 127
    || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 192 && second === 0 && (third === 0 || third === 2))
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113);
}

function ipv6Parts(hostname: string): number[] | null {
  let value = hostname.toLowerCase();
  if (value.includes(".")) {
    const split = value.lastIndexOf(":");
    if (split < 0) return null;
    const ipv4 = value.slice(split + 1);
    const octets = ipv4.split(".").map((part) => Number(part));
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    value = `${value.slice(0, split)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: Math.max(0, missing) }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

function privateIpv6(hostname: string): boolean {
  const groups = ipv6Parts(hostname);
  if (!groups) return true;
  const allZero = groups.every((group) => group === 0);
  const loopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const uniqueLocal = (groups[0] & 0xfe00) === 0xfc00;
  const linkLocal = (groups[0] & 0xffc0) === 0xfe80;
  const multicast = (groups[0] & 0xff00) === 0xff00;
  const documentation = groups[0] === 0x2001 && groups[1] === 0x0db8;
  const ipv4Mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (allZero || loopback || uniqueLocal || linkLocal || multicast || documentation) return true;
  if (!ipv4Mapped) return false;
  return privateIpv4([
    groups[6] >> 8,
    groups[6] & 0xff,
    groups[7] >> 8,
    groups[7] & 0xff,
  ].join("."));
}

export function safeRemoteAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (normalized.includes(":")) return ipv6Parts(normalized) !== null && !privateIpv6(normalized);
  const parts = normalized.split(".").map((part) => Number(part));
  const validIpv4 = parts.length === 4
    && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  return validIpv4 && !privateIpv4(normalized);
}

export function safeRemoteImageUrl(value: string, base?: URL): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(value, base);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname.endsWith(".home")
    || hostname.endsWith(".lan")) return null;
  if (hostname.includes(":")) return privateIpv6(hostname) ? null : parsed;
  return privateIpv4(hostname) ? null : parsed;
}
