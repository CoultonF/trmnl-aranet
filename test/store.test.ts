import { afterEach, describe, expect, test } from "bun:test";
import { PluginStore, type PluginConfiguration } from "../src/store.ts";
import type { AranetReading } from "../src/home-assistant.ts";

const stores: PluginStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

const configuration: PluginConfiguration = {
  haUrl: "https://ha.example.com/",
  encryptedHaToken: "encrypted-token",
  device: {
    name: "Aranet Radon",
    prefix: "sensor.aranetrn_38b33",
    entities: {
      radon: "sensor.aranetrn_38b33_radon_concentration",
      threshold: "sensor.aranetrn_38b33_threshold",
      temperature: "sensor.aranetrn_38b33_temperature",
      humidity: "sensor.aranetrn_38b33_humidity",
      pressure: "sensor.aranetrn_38b33_pressure",
      battery: "sensor.aranetrn_38b33_battery",
    },
  },
};

const reading: AranetReading = {
  deviceName: "Aranet Radon",
  radon: 50,
  radonUnit: "Bq/m³",
  threshold: "green",
  temperature: 21.2,
  temperatureUnit: "°C",
  humidity: 43.2,
  humidityUnit: "%",
  pressure: 885.1,
  pressureUnit: "hPa",
  battery: 96,
  batteryUnit: "%",
  observedAt: "2026-07-29T21:00:00.000Z",
  stale: false,
};

describe("plugin store", () => {
  test("persists installation, configuration, activation, and lookup", () => {
    const store = new PluginStore(":memory:");
    stores.push(store);

    store.createPending({
      accessTokenHash: "access-hash",
      installationState: "install-state",
      callbackUrl: "https://trmnl.com/plugin_settings/new?code=abc",
      createdAt: "2026-07-29T20:00:00.000Z",
    });
    expect(store.getPendingByState("install-state")?.callbackUrl).toContain("trmnl.com");

    store.saveConfiguration("install-state", configuration);
    store.activate({
      accessTokenHash: "access-hash",
      userUuid: "user-uuid",
      pluginSettingId: 1234,
      instanceName: "Basement",
      locale: "en-CA",
      timeZone: "America/Edmonton",
    });

    expect(store.getByAccessTokenHash("access-hash")).toMatchObject({
      userUuid: "user-uuid",
      pluginSettingId: 1234,
      instanceName: "Basement",
      locale: "en-CA",
      timeZone: "America/Edmonton",
      configuration,
    });
    expect(store.getByUserUuid("user-uuid")?.accessTokenHash).toBe("access-hash");
    const updatedConfiguration = {
      ...configuration,
      haUrl: "https://new-ha.example.com/",
      encryptedHaToken: "new-encrypted-token",
    };
    store.updateConfigurationByUserUuid("user-uuid", updatedConfiguration);
    expect(store.getByUserUuid("user-uuid")?.configuration).toEqual(
      updatedConfiguration,
    );
  });

  test("stores a last-known reading and removes all data on uninstall", () => {
    const store = new PluginStore(":memory:");
    stores.push(store);
    store.createPending({
      accessTokenHash: "access-hash",
      installationState: "install-state",
      callbackUrl: "https://trmnl.com/callback",
      createdAt: "2026-07-29T20:00:00.000Z",
    });
    store.saveConfiguration("install-state", configuration);
    store.activate({
      accessTokenHash: "access-hash",
      userUuid: "user-uuid",
      pluginSettingId: 1234,
      instanceName: "Basement",
      locale: "en-CA",
      timeZone: "America/Edmonton",
    });

    store.saveReading("access-hash", reading);
    expect(store.getByAccessTokenHash("access-hash")?.lastReading).toEqual(reading);

    expect(store.deleteByUserUuid("user-uuid")).toBe(true);
    expect(store.getByUserUuid("user-uuid")).toBeNull();
    expect(store.getByAccessTokenHash("access-hash")).toBeNull();
  });
});
