import { describe, expect, test } from "bun:test";
import {
  exchangeInstallationCode,
  readBearerToken,
  validateInstallationCallback,
} from "../src/trmnl.ts";

describe("TRMNL protocol", () => {
  test("exchanges a single-use installation code as form data", async () => {
    let request: Request | undefined;
    const token = await exchangeInstallationCode("abc 123", async (input, init) => {
      request = new Request(input, init);
      return Response.json({ access_token: "plugin-access-token" });
    });

    expect(token).toBe("plugin-access-token");
    expect(request?.url).toBe("https://trmnl.com/oauth/token");
    expect(request?.headers.get("content-type")).toContain("application/x-www-form-urlencoded");
    expect(await request?.text()).toBe("code=abc+123");
  });

  test("treats TRMNL's HTTP 200 error body as a failed exchange", async () => {
    expect(
      exchangeInstallationCode("bad-code", async () =>
        Response.json({ error: true, message: "invalid code" }),
      ),
    ).rejects.toThrow("invalid code");
  });

  test("allows only HTTPS callbacks on trmnl.com", () => {
    expect(
      validateInstallationCallback(
        "https://trmnl.com/plugin_settings/new?keyname=aranet&code=abc",
      ).hostname,
    ).toBe("trmnl.com");
    expect(() => validateInstallationCallback("https://evil.example/callback")).toThrow();
    expect(() => validateInstallationCallback("http://trmnl.com/callback")).toThrow();
  });

  test("extracts a bearer token and rejects other authorization schemes", () => {
    expect(
      readBearerToken(
        new Request("https://plugin.example/markup", {
          headers: { authorization: "Bearer secret" },
        }),
      ),
    ).toBe("secret");
    expect(() => readBearerToken(new Request("https://plugin.example/markup"))).toThrow();
    expect(() =>
      readBearerToken(
        new Request("https://plugin.example/markup", {
          headers: { authorization: "Basic abc" },
        }),
      ),
    ).toThrow();
  });
});
