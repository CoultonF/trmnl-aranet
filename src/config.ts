export interface RuntimeConfig {
  encryptionKey: Uint8Array;
  databasePath: string;
  port: number;
  allowedPrivateHosts: ReadonlySet<string>;
}

export function loadConfig(
  environment: Record<string, string | undefined>,
): RuntimeConfig {
  const encodedKey = environment.DATA_ENCRYPTION_KEY;
  if (!encodedKey) {
    throw new Error("DATA_ENCRYPTION_KEY is required");
  }
  const encryptionKey = new Uint8Array(Buffer.from(encodedKey, "base64"));
  if (encryptionKey.byteLength !== 32) {
    throw new Error("DATA_ENCRYPTION_KEY must decode to 32 bytes");
  }

  const port = Number(environment.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const allowedPrivateHosts = new Set(
    (environment.ALLOWED_PRIVATE_HA_HOSTS ?? "")
      .split(",")
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean),
  );

  return {
    encryptionKey,
    databasePath: environment.DATABASE_PATH ?? "/data/plugin.sqlite",
    port,
    allowedPrivateHosts,
  };
}
