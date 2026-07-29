import type { TokenProtector } from "./crypto.ts";
import { hashAccessToken } from "./crypto.ts";
import {
  discoverAranetDevices,
  fetchAranetReading,
  type AranetDevice,
  type AranetReading,
  type Fetch,
} from "./home-assistant.ts";
import { renderPluginLayouts } from "./markup.ts";
import { validateHomeAssistantUrl, type ResolveHost } from "./security.ts";
import type { PluginConnection, PluginStore } from "./store.ts";
import {
  exchangeInstallationCode,
  readBearerToken,
  validateInstallationCallback,
} from "./trmnl.ts";

export interface AppDependencies {
  store: PluginStore;
  tokenProtector: TokenProtector;
  fetcher: Fetch;
  resolveHost: ResolveHost;
  allowedPrivateHosts: ReadonlySet<string>;
  randomState: () => string;
  now: () => Date;
}

export type App = (request: Request) => Promise<Response>;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aranet Radon for TRMNL</title></head><body>${body}</body></html>`, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

function renderConfigurationForm(options: {
  action: string;
  installationState?: string;
  userUuid?: string;
  haUrl?: string;
  entityPrefix?: string;
  error?: string;
}): Response {
  const hidden = options.installationState
    ? `<input type="hidden" name="installation_state" value="${escapeHtml(options.installationState)}">`
    : `<input type="hidden" name="user_uuid" value="${escapeHtml(options.userUuid ?? "")}">`;
  const tokenHelp = options.userUuid
    ? "Leave blank to keep the existing token."
    : "Create a long-lived token in Home Assistant under Profile → Security.";
  return htmlResponse(`
    <main style="max-width:42rem;margin:3rem auto;font:16px system-ui;line-height:1.5;padding:0 1rem">
      <h1>Aranet Radon for TRMNL</h1>
      <p>Connect a publicly reachable Home Assistant instance and choose an Aranet Radon device.</p>
      ${options.error ? `<p role="alert" style="border:2px solid;padding:0.75rem"><strong>${escapeHtml(options.error)}</strong></p>` : ""}
      <form method="post" action="${options.action}">
        ${hidden}
        <label>Home Assistant URL<br><input required type="url" name="ha_url" size="48" value="${escapeHtml(options.haUrl ?? "")}" placeholder="https://ha.example.com"></label><br><br>
        <label>Long-lived access token<br><input ${options.userUuid ? "" : "required"} type="password" name="ha_token" size="48" autocomplete="off"></label>
        <p><small>${tokenHelp}</small></p>
        <label>Aranet entity prefix<br><input name="entity_prefix" size="48" value="${escapeHtml(options.entityPrefix ?? "")}" placeholder="sensor.aranetrn_38b33"></label>
        <p><small>Optional when Home Assistant contains exactly one Aranet Radon device.</small></p>
        <button type="submit">Connect Aranet</button>
      </form>
    </main>
  `);
}

async function readConfiguration(
  request: Request,
  dependencies: AppDependencies,
  existing?: PluginConnection,
): Promise<{ baseUrl: URL; token: string; device: AranetDevice }> {
  const form = await request.formData();
  const rawUrl = form.get("ha_url");
  const rawToken = form.get("ha_token");
  const rawPrefix = form.get("entity_prefix");
  if (typeof rawUrl !== "string" || typeof rawPrefix !== "string") {
    throw new Error("Home Assistant URL and entity prefix must be text");
  }

  const baseUrl = await validateHomeAssistantUrl(
    rawUrl,
    dependencies.resolveHost,
    dependencies.allowedPrivateHosts,
  );
  const token =
    typeof rawToken === "string" && rawToken.length > 0
      ? rawToken
      : existing
        ? await dependencies.tokenProtector.decrypt(
            existing.configuration.encryptedHaToken,
          )
        : "";
  if (!token) {
    throw new Error("A Home Assistant access token is required");
  }

  const devices = await discoverAranetDevices(
    baseUrl,
    token,
    dependencies.fetcher,
  );
  const device = rawPrefix
    ? devices.find((candidate) => candidate.prefix === rawPrefix)
    : devices.length === 1
      ? devices[0]
      : undefined;
  if (!device) {
    const suffix = devices.length
      ? ` Detected: ${devices.map((candidate) => candidate.prefix).join(", ")}`
      : " No complete Aranet Radon device was detected.";
    throw new Error(`The requested Aranet entity prefix was not found.${suffix}`);
  }

  return { baseUrl, token, device };
}

function connectionContext(
  connection: PluginConnection,
  form: FormData,
): { instanceName: string; locale: string; timeZone: string } {
  const rawMetadata = form.get("trmnl");
  if (typeof rawMetadata !== "string") {
    return {
      instanceName: connection.instanceName,
      locale: connection.locale,
      timeZone: connection.timeZone,
    };
  }

  try {
    const metadata = JSON.parse(rawMetadata) as {
      user?: { locale?: unknown; time_zone_iana?: unknown };
      plugin_settings?: { instance_name?: unknown };
    };
    return {
      instanceName:
        typeof metadata.plugin_settings?.instance_name === "string"
          ? metadata.plugin_settings.instance_name
          : connection.instanceName,
      locale:
        typeof metadata.user?.locale === "string"
          ? metadata.user.locale
          : connection.locale,
      timeZone:
        typeof metadata.user?.time_zone_iana === "string"
          ? metadata.user.time_zone_iana
          : connection.timeZone,
    };
  } catch {
    return {
      instanceName: connection.instanceName,
      locale: connection.locale,
      timeZone: connection.timeZone,
    };
  }
}

function errorLayouts(message: string): Record<string, string> {
  const escaped = escapeHtml(message);
  const render = (view: string) => `<div class="view ${view}"><div class="layout"><div class="item item--emphasis-3"><div class="meta"></div><div class="content"><span class="title">Aranet unavailable</span><span class="description">${escaped}</span></div></div></div><div class="title_bar"><span class="title">Aranet Radon</span></div></div>`;
  return {
    markup: render("view--full"),
    markup_half_horizontal: render("view--half_horizontal"),
    markup_half_vertical: render("view--half_vertical"),
    markup_quadrant: render("view--quadrant"),
    shared: "",
  };
}

export function createApp(dependencies: AppDependencies): App {
  return async (request) => {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/healthz") {
        return Response.json({ status: "ok" });
      }

      if (request.method === "GET" && url.pathname === "/install") {
        const code = url.searchParams.get("code");
        const callback = url.searchParams.get("installation_callback_url");
        if (!code || !callback) {
          return htmlResponse("<h1>Missing installation parameters</h1>", 400);
        }
        const callbackUrl = validateInstallationCallback(callback);
        const accessToken = await exchangeInstallationCode(
          code,
          dependencies.fetcher,
        );
        const installationState = dependencies.randomState();
        dependencies.store.createPending({
          accessTokenHash: await hashAccessToken(accessToken),
          installationState,
          callbackUrl: callbackUrl.href,
          createdAt: dependencies.now().toISOString(),
        });
        return renderConfigurationForm({
          action: "/install",
          installationState,
        });
      }

      if (request.method === "POST" && url.pathname === "/install") {
        const clonedRequest = request.clone();
        const form = await clonedRequest.formData();
        const state = form.get("installation_state");
        if (typeof state !== "string") {
          return htmlResponse("<h1>Installation session is missing</h1>", 400);
        }
        const pending = dependencies.store.getPendingByState(state);
        if (!pending) {
          return htmlResponse("<h1>Installation session expired</h1>", 400);
        }
        try {
          const configuration = await readConfiguration(request, dependencies);
          dependencies.store.saveConfiguration(state, {
            haUrl: configuration.baseUrl.href,
            encryptedHaToken: await dependencies.tokenProtector.encrypt(
              configuration.token,
            ),
            device: configuration.device,
          });
          return Response.redirect(pending.callbackUrl, 303);
        } catch (error) {
          return renderConfigurationForm({
            action: "/install",
            installationState: state,
            error: error instanceof Error ? error.message : "Configuration failed",
          });
        }
      }

      if (
        request.method === "POST" &&
        url.pathname === "/webhooks/installation"
      ) {
        const tokenHash = await hashAccessToken(readBearerToken(request));
        const payload = (await request.json()) as {
          user?: {
            plugin_setting_id?: unknown;
            uuid?: unknown;
            locale?: unknown;
            time_zone_iana?: unknown;
          };
        };
        if (
          typeof payload.user?.plugin_setting_id !== "number" ||
          typeof payload.user.uuid !== "string"
        ) {
          return new Response("Invalid installation webhook", { status: 400 });
        }
        dependencies.store.activate({
          accessTokenHash: tokenHash,
          userUuid: payload.user.uuid,
          pluginSettingId: payload.user.plugin_setting_id,
          instanceName: "Aranet Radon",
          locale:
            typeof payload.user.locale === "string" ? payload.user.locale : "en",
          timeZone:
            typeof payload.user.time_zone_iana === "string"
              ? payload.user.time_zone_iana
              : "UTC",
        });
        return new Response(null, { status: 204 });
      }

      if (request.method === "POST" && url.pathname === "/markup") {
        const tokenHash = await hashAccessToken(readBearerToken(request));
        const connection = dependencies.store.getByAccessTokenHash(tokenHash);
        if (!connection) {
          return new Response("Unauthorized", { status: 401 });
        }
        const form = await request.formData();
        const requestedUuid = form.get("user_uuid");
        if (
          typeof requestedUuid === "string" &&
          requestedUuid !== connection.userUuid
        ) {
          return new Response("Unauthorized", { status: 401 });
        }

        let reading: AranetReading;
        try {
          const baseUrl = await validateHomeAssistantUrl(
            connection.configuration.haUrl,
            dependencies.resolveHost,
            dependencies.allowedPrivateHosts,
          );
          reading = await fetchAranetReading(
            baseUrl,
            await dependencies.tokenProtector.decrypt(
              connection.configuration.encryptedHaToken,
            ),
            connection.configuration.device,
            dependencies.fetcher,
            dependencies.now(),
          );
          dependencies.store.saveReading(tokenHash, reading);
        } catch (error) {
          if (!connection.lastReading) {
            const message = error instanceof Error ? error.message : "Unknown error";
            return Response.json(errorLayouts(message));
          }
          reading = { ...connection.lastReading, stale: true };
        }

        return Response.json(
          renderPluginLayouts(reading, connectionContext(connection, form)),
        );
      }


      if (request.method === "GET" && url.pathname === "/manage") {
        const userUuid = url.searchParams.get("uuid");
        const connection = userUuid
          ? dependencies.store.getByUserUuid(userUuid)
          : null;
        if (!connection) {
          return htmlResponse("<h1>Plugin connection not found</h1>", 404);
        }
        return renderConfigurationForm({
          action: "/manage",
          userUuid: connection.userUuid,
          haUrl: connection.configuration.haUrl,
          entityPrefix: connection.configuration.device.prefix,
        });
      }

      if (request.method === "POST" && url.pathname === "/manage") {
        const clonedRequest = request.clone();
        const form = await clonedRequest.formData();
        const userUuid = form.get("user_uuid");
        if (typeof userUuid !== "string") {
          return htmlResponse("<h1>Plugin connection not found</h1>", 404);
        }
        const connection = dependencies.store.getByUserUuid(userUuid);
        if (!connection) {
          return htmlResponse("<h1>Plugin connection not found</h1>", 404);
        }
        try {
          const configuration = await readConfiguration(
            request,
            dependencies,
            connection,
          );
          dependencies.store.updateConfigurationByUserUuid(userUuid, {
            haUrl: configuration.baseUrl.href,
            encryptedHaToken: await dependencies.tokenProtector.encrypt(
              configuration.token,
            ),
            device: configuration.device,
          });
          return Response.redirect(
            `https://trmnl.com/plugin_settings/${connection.pluginSettingId}/edit?force_refresh=true`,
            303,
          );
        } catch (error) {
          return renderConfigurationForm({
            action: "/manage",
            userUuid,
            haUrl: connection.configuration.haUrl,
            entityPrefix: connection.configuration.device.prefix,
            error: error instanceof Error ? error.message : "Configuration failed",
          });
        }
      }

      if (
        request.method === "POST" &&
        url.pathname === "/webhooks/uninstall"
      ) {
        const tokenHash = await hashAccessToken(readBearerToken(request));
        const connection = dependencies.store.getByAccessTokenHash(tokenHash);
        const payload = (await request.json()) as { user_uuid?: unknown };
        if (
          !connection ||
          typeof payload.user_uuid !== "string" ||
          payload.user_uuid !== connection.userUuid
        ) {
          return new Response("Unauthorized", { status: 401 });
        }
        dependencies.store.deleteByUserUuid(connection.userUuid);
        return new Response(null, { status: 204 });
      }

      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error("request_failed", {
        method: request.method,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      });
      return new Response("Request failed", { status: 400 });
    }
  };
}
