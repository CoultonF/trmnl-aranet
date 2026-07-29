import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { createTokenProtector } from "../src/crypto.ts";
import { PluginStore } from "../src/store.ts";
import type { Fetch } from "../src/home-assistant.ts";

const entityPrefix = "sensor.aranetrn_38b33";
const states = [
  { entity_id: `${entityPrefix}_radon_concentration`, state: "50", attributes: { friendly_name: "Aranet Radon Radon concentration", unit_of_measurement: "Bq/m³" } },
  { entity_id: `${entityPrefix}_threshold`, state: "green", attributes: { friendly_name: "Aranet Radon Threshold" } },
  { entity_id: `${entityPrefix}_temperature`, state: "21.2", attributes: { friendly_name: "Aranet Radon Temperature", unit_of_measurement: "°C" } },
  { entity_id: `${entityPrefix}_humidity`, state: "43.2", attributes: { friendly_name: "Aranet Radon Humidity", unit_of_measurement: "%" } },
  { entity_id: `${entityPrefix}_pressure`, state: "885.10", attributes: { friendly_name: "Aranet Radon Pressure", unit_of_measurement: "hPa" } },
  { entity_id: `${entityPrefix}_battery`, state: "96", attributes: { friendly_name: "Aranet Radon Battery", unit_of_measurement: "%" } },
];

function makeFetcher(): { fetcher: Fetch; failHomeAssistant: () => void } {
  let failHa = false;
  return {
    failHomeAssistant: () => {
      failHa = true;
    },
    fetcher: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.href === "https://trmnl.com/oauth/token") {
        return Response.json({ access_token: "plugin-access-token" });
      }
      if (url.hostname === "192.168.0.96") {
        if (failHa) return new Response("offline", { status: 503 });
        if (url.pathname === "/api/states") return Response.json(states);
        const entityId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        const state = states.find((candidate) => candidate.entity_id === entityId);
        return state ? Response.json(state) : new Response("missing", { status: 404 });
      }
      return new Response("unexpected", { status: 500 });
    },
  };
}

let store: PluginStore;
beforeEach(() => {
  store = new PluginStore(":memory:");
});
afterEach(() => store.close());

type App = (request: Request) => Promise<Response>;

async function install(app: App): Promise<void> {
  const installPage = await app(
    new Request(
      "https://trmnl.coultonf.com/install?code=abc&installation_callback_url=" +
        encodeURIComponent("https://trmnl.com/plugin_settings/new?keyname=aranet&code=abc"),
    ),
  );
  expect(installPage.status).toBe(200);
  const html = await installPage.text();
  expect(html).toContain('name="installation_state" value="install-state"');

  const configuration = await app(
    new Request("https://trmnl.coultonf.com/install", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        installation_state: "install-state",
        ha_url: "http://192.168.0.96:8123",
        ha_token: "ha-secret",
        entity_prefix: entityPrefix,
      }),
    }),
  );
  expect(configuration.status).toBe(303);
  expect(configuration.headers.get("location")).toContain("trmnl.com/plugin_settings/new");

  const success = await app(
    new Request("https://trmnl.coultonf.com/webhooks/installation", {
      method: "POST",
      headers: {
        authorization: "Bearer plugin-access-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        user: {
          plugin_setting_id: 1234,
          uuid: "user-uuid",
          locale: "en-CA",
          time_zone_iana: "America/Edmonton",
        },
      }),
    }),
  );
  expect(success.status).toBe(204);
}

describe("TRMNL Aranet application", () => {
  test("completes installation and generates all live markup layouts", async () => {
    const { fetcher } = makeFetcher();
    const app = createApp({
      store,
      tokenProtector: createTokenProtector(new Uint8Array(32).fill(3)),
      fetcher,
      resolveHost: async () => ["192.168.0.96"],
      allowedPrivateHosts: new Set(["192.168.0.96"]),
      randomState: () => "install-state",
      now: () => new Date("2026-07-29T21:00:00Z"),
    });
    await install(app);

    const markup = await app(
      new Request("https://trmnl.coultonf.com/markup", {
        method: "POST",
        headers: {
          authorization: "Bearer plugin-access-token",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          user_uuid: "user-uuid",
          trmnl: JSON.stringify({ plugin_settings: { instance_name: "Basement" } }),
        }),
      }),
    );

    expect(markup.status).toBe(200);
    const payload = await markup.json();
    expect(payload.markup).toContain(">50<");
    expect(payload.markup_half_horizontal).toContain("21.2 °C");
    expect(payload.markup_half_vertical).toContain("Aranet Radon");
    expect(payload.markup_quadrant).toContain("Bq/m³");
  });

  test("reuses an installation session when its URL is refreshed", async () => {
    const { fetcher } = makeFetcher();
    let stateIndex = 0;
    const app = createApp({
      store,
      tokenProtector: createTokenProtector(new Uint8Array(32).fill(3)),
      fetcher,
      resolveHost: async () => ["192.168.0.96"],
      allowedPrivateHosts: new Set(["192.168.0.96"]),
      randomState: () => ["first-state", "second-state"][stateIndex++]!,
      now: () => new Date("2026-07-29T21:00:00Z"),
    });
    const request = () =>
      new Request(
        "https://trmnl.coultonf.com/install?code=abc&installation_callback_url=" +
          encodeURIComponent(
            "https://trmnl.com/plugin_settings/new?keyname=aranet&code=abc",
          ),
      );

    expect((await app(request())).status).toBe(200);
    const refreshed = await app(request());

    expect(refreshed.status).toBe(200);
    expect(await refreshed.text()).toContain(
      'name="installation_state" value="first-state"',
    );
  });

  test("resumes a configured install refresh at TRMNL", async () => {
    const { fetcher } = makeFetcher();
    const app = createApp({
      store,
      tokenProtector: createTokenProtector(new Uint8Array(32).fill(3)),
      fetcher,
      resolveHost: async () => ["192.168.0.96"],
      allowedPrivateHosts: new Set(["192.168.0.96"]),
      randomState: () => "install-state",
      now: () => new Date("2026-07-29T21:00:00Z"),
    });
    await install(app);

    const refreshed = await app(
      new Request(
        "https://trmnl.coultonf.com/install?code=abc&installation_callback_url=" +
          encodeURIComponent(
            "https://trmnl.com/plugin_settings/new?keyname=aranet&code=abc",
          ),
      ),
    );

    expect(refreshed.status).toBe(303);
    expect(refreshed.headers.get("location")).toContain(
      "trmnl.com/plugin_settings/new",
    );
  });

  test("serves last-known values as stale when Home Assistant is offline", async () => {
    const { fetcher, failHomeAssistant } = makeFetcher();
    const app = createApp({
      store,
      tokenProtector: createTokenProtector(new Uint8Array(32).fill(3)),
      fetcher,
      resolveHost: async () => ["192.168.0.96"],
      allowedPrivateHosts: new Set(["192.168.0.96"]),
      randomState: () => "install-state",
      now: () => new Date("2026-07-29T21:00:00Z"),
    });
    await install(app);

    const markupRequest = () =>
      new Request("https://trmnl.coultonf.com/markup", {
        method: "POST",
        headers: {
          authorization: "Bearer plugin-access-token",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ user_uuid: "user-uuid" }),
      });
    expect((await app(markupRequest())).status).toBe(200);
    failHomeAssistant();

    const stalePayload = await (await app(markupRequest())).json();
    expect(stalePayload.markup).toContain("STALE");
  });

  test("authenticates uninstall requests before deleting all user data", async () => {
    const { fetcher } = makeFetcher();
    const app = createApp({
      store,
      tokenProtector: createTokenProtector(new Uint8Array(32).fill(3)),
      fetcher,
      resolveHost: async () => ["192.168.0.96"],
      allowedPrivateHosts: new Set(["192.168.0.96"]),
      randomState: () => "install-state",
      now: () => new Date("2026-07-29T21:00:00Z"),
    });
    await install(app);

    const unauthorized = await app(
      new Request("https://trmnl.coultonf.com/webhooks/uninstall", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ user_uuid: "user-uuid" }),
      }),
    );
    expect(unauthorized.status).toBe(401);
    expect(store.getByUserUuid("user-uuid")).not.toBeNull();

    const removed = await app(
      new Request("https://trmnl.coultonf.com/webhooks/uninstall", {
        method: "POST",
        headers: {
          authorization: "Bearer plugin-access-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ user_uuid: "user-uuid" }),
      }),
    );
    expect(removed.status).toBe(204);
    expect(store.getByUserUuid("user-uuid")).toBeNull();
  });

  test("shows and updates management settings without exposing the saved token", async () => {
    const { fetcher } = makeFetcher();
    const app = createApp({
      store,
      tokenProtector: createTokenProtector(new Uint8Array(32).fill(3)),
      fetcher,
      resolveHost: async () => ["192.168.0.96"],
      allowedPrivateHosts: new Set(["192.168.0.96"]),
      randomState: () => "install-state",
      now: () => new Date("2026-07-29T21:00:00Z"),
    });
    await install(app);

    const managementPage = await app(
      new Request("https://trmnl.coultonf.com/manage?uuid=user-uuid"),
    );
    expect(managementPage.status).toBe(200);
    const html = await managementPage.text();
    expect(html).toContain("http://192.168.0.96:8123/");
    expect(html).toContain(entityPrefix);
    expect(html).not.toContain("ha-secret");

    const updated = await app(
      new Request("https://trmnl.coultonf.com/manage", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          user_uuid: "user-uuid",
          ha_url: "http://192.168.0.96:8123",
          ha_token: "",
          entity_prefix: entityPrefix,
        }),
      }),
    );
    expect(updated.status).toBe(303);
    expect(updated.headers.get("location")).toBe(
      "https://trmnl.com/plugin_settings/1234/edit?force_refresh=true",
    );
  });

  test("returns valid error layouts when no live or cached reading exists", async () => {
    const { fetcher, failHomeAssistant } = makeFetcher();
    const app = createApp({
      store,
      tokenProtector: createTokenProtector(new Uint8Array(32).fill(3)),
      fetcher,
      resolveHost: async () => ["192.168.0.96"],
      allowedPrivateHosts: new Set(["192.168.0.96"]),
      randomState: () => "install-state",
      now: () => new Date("2026-07-29T21:00:00Z"),
    });
    await install(app);
    failHomeAssistant();

    const response = await app(
      new Request("https://trmnl.coultonf.com/markup", {
        method: "POST",
        headers: {
          authorization: "Bearer plugin-access-token",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ user_uuid: "user-uuid" }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.markup).toContain("Aranet unavailable");
    expect(payload.markup_half_horizontal).toContain("Aranet unavailable");
    expect(payload.markup_half_vertical).toContain("Aranet unavailable");
    expect(payload.markup_quadrant).toContain("Aranet unavailable");
  });
});
