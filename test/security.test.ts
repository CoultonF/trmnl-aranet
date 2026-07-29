import { describe, expect, test } from "bun:test";
import { validateHomeAssistantUrl } from "../src/security.ts";

const publicResolver = async () => ["93.184.216.34"];

describe("Home Assistant URL validation", () => {
  test("accepts an HTTPS origin that resolves publicly", async () => {
    const url = await validateHomeAssistantUrl(
      "https://ha.example.com/",
      publicResolver,
      new Set(),
    );

    expect(url.href).toBe("https://ha.example.com/");
  });

  test("rejects HTTP for public hosts", async () => {
    expect(
      validateHomeAssistantUrl(
        "http://ha.example.com",
        publicResolver,
        new Set(),
      ),
    ).rejects.toThrow("HTTPS");
  });

  test("rejects credentials and non-origin paths", async () => {
    expect(
      validateHomeAssistantUrl(
        "https://user:pass@ha.example.com",
        publicResolver,
        new Set(),
      ),
    ).rejects.toThrow("credentials");
    expect(
      validateHomeAssistantUrl(
        "https://ha.example.com/api",
        publicResolver,
        new Set(),
      ),
    ).rejects.toThrow("origin");
  });

  test("rejects hosts resolving to private, loopback, link-local, or unspecified addresses", async () => {
    for (const address of [
      "10.0.0.4",
      "172.16.1.2",
      "192.168.0.96",
      "127.0.0.1",
      "169.254.169.254",
      "::1",
      "fc00::1",
      "fe80::1",
      "0.0.0.0",
    ]) {
      expect(
        validateHomeAssistantUrl(
          "https://ha.example.com",
          async () => [address],
          new Set(),
        ),
      ).rejects.toThrow("private network");
    }
  });

  test("allows one explicitly configured private host for homelab testing", async () => {
    const url = await validateHomeAssistantUrl(
      "http://192.168.0.96:8123",
      async () => ["192.168.0.96"],
      new Set(["192.168.0.96"]),
    );

    expect(url.href).toBe("http://192.168.0.96:8123/");
  });
});
