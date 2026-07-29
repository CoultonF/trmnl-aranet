import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";

describe("runtime configuration", () => {
  test("loads a 32-byte key and private-host allowlist", () => {
    const config = loadConfig({
      DATA_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64"),
      DATABASE_PATH: "/data/plugin.sqlite",
      PORT: "3000",
      ALLOWED_PRIVATE_HA_HOSTS: "192.168.0.96,ha.internal",
    });

    expect(config.encryptionKey).toEqual(new Uint8Array(32).fill(4));
    expect(config.databasePath).toBe("/data/plugin.sqlite");
    expect(config.port).toBe(3000);
    expect([...config.allowedPrivateHosts]).toEqual(["192.168.0.96", "ha.internal"]);
  });

  test("rejects missing or malformed encryption keys and ports", () => {
    expect(() => loadConfig({})).toThrow("DATA_ENCRYPTION_KEY");
    expect(() =>
      loadConfig({ DATA_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }),
    ).toThrow("32 bytes");
    expect(() =>
      loadConfig({
        DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
        PORT: "70000",
      }),
    ).toThrow("PORT");
  });
});
