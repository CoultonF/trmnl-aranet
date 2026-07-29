import { lookup } from "node:dns/promises";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createTokenProtector } from "./crypto.ts";
import { PluginStore } from "./store.ts";

const config = loadConfig(Bun.env);
const store = new PluginStore(config.databasePath);
const app = createApp({
  store,
  tokenProtector: createTokenProtector(config.encryptionKey),
  fetcher: fetch,
  resolveHost: async (hostname) =>
    (await lookup(hostname, { all: true, verbatim: true })).map(
      (result) => result.address,
    ),
  allowedPrivateHosts: config.allowedPrivateHosts,
  randomState: () => crypto.randomUUID(),
  now: () => new Date(),
});

const server = Bun.serve({
  port: config.port,
  fetch: app,
});

console.log("server_started", { url: server.url.href });

const shutdown = () => {
  server.stop();
  store.close();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
