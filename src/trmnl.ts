import type { Fetch } from "./home-assistant.ts";

export async function exchangeInstallationCode(
  code: string,
  fetcher: Fetch,
): Promise<string> {
  const response = await fetcher("https://trmnl.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code }),
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`TRMNL token exchange failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  if (payload.error === true) {
    throw new Error(
      typeof payload.message === "string"
        ? payload.message
        : "TRMNL rejected the installation code",
    );
  }
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    throw new Error("TRMNL token response did not include an access token");
  }
  return payload.access_token;
}

export function validateInstallationCallback(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Installation callback URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "trmnl.com" ||
    url.username ||
    url.password
  ) {
    throw new Error("Installation callback must be an HTTPS trmnl.com URL");
  }
  return url;
}

export function readBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  if (!match?.[1]) {
    throw new Error("Bearer authorization is required");
  }
  return match[1];
}
