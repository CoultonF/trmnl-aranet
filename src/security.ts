export type ResolveHost = (hostname: string) => Promise<string[]>;

function isPrivateAddress(address: string): boolean {
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.")
    );
  }

  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    throw new Error(`Resolver returned invalid address: ${address}`);
  }

  const [first, second] = octets as [number, number, number, number];
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export async function validateHomeAssistantUrl(
  rawUrl: string,
  resolveHost: ResolveHost,
  allowedPrivateHosts: ReadonlySet<string>,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Home Assistant URL is invalid");
  }

  if (url.username || url.password) {
    throw new Error("Home Assistant URL must not contain credentials");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Home Assistant URL must contain only an origin");
  }

  const hostname = url.hostname.toLowerCase();
  if (allowedPrivateHosts.has(hostname)) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Home Assistant URL must use HTTP or HTTPS");
    }
    return url;
  }

  if (url.protocol !== "https:") {
    throw new Error("Public Home Assistant URLs must use HTTPS");
  }

  const addresses = await resolveHost(hostname);
  if (addresses.length === 0) {
    throw new Error("Home Assistant hostname did not resolve");
  }
  if (addresses.some(isPrivateAddress)) {
    throw new Error("Home Assistant URL resolves to a private network");
  }

  return url;
}
