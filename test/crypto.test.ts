import { describe, expect, test } from "bun:test";
import { createTokenProtector, hashAccessToken } from "../src/crypto.ts";

describe("token protection", () => {
  test("encrypts Home Assistant tokens with randomized authenticated ciphertext", async () => {
    const protector = createTokenProtector(new Uint8Array(32).fill(7));

    const first = await protector.encrypt("ha-token");
    const second = await protector.encrypt("ha-token");

    expect(first).not.toBe(second);
    expect(await protector.decrypt(first)).toBe("ha-token");
    expect(await protector.decrypt(second)).toBe("ha-token");
  });

  test("rejects ciphertext changed after encryption", async () => {
    const protector = createTokenProtector(new Uint8Array(32).fill(9));
    const ciphertext = await protector.encrypt("ha-token");
    const changed = `${ciphertext.slice(0, -1)}${ciphertext.endsWith("A") ? "B" : "A"}`;

    expect(protector.decrypt(changed)).rejects.toThrow();
  });

  test("hashes TRMNL access tokens deterministically without retaining them", async () => {
    const first = await hashAccessToken("trmnl-token");
    const second = await hashAccessToken("trmnl-token");

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("trmnl-token");
  });
});
