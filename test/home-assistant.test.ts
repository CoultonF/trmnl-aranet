import { describe, expect, test } from "bun:test";
import {
  discoverAranetDevices,
  fetchAranetReading,
  type AranetEntities,
} from "../src/home-assistant.ts";

const entities: AranetEntities = {
  radon: "sensor.aranetrn_38b33_radon_concentration",
  threshold: "sensor.aranetrn_38b33_threshold",
  temperature: "sensor.aranetrn_38b33_temperature",
  humidity: "sensor.aranetrn_38b33_humidity",
  pressure: "sensor.aranetrn_38b33_pressure",
  battery: "sensor.aranetrn_38b33_battery",
};

const states = [
  { entity_id: entities.radon, state: "50", attributes: { friendly_name: "Aranet Radon Radon concentration", unit_of_measurement: "Bq/m³" } },
  { entity_id: entities.threshold, state: "green", attributes: { friendly_name: "Aranet Radon Threshold" } },
  { entity_id: entities.temperature, state: "21.2", attributes: { friendly_name: "Aranet Radon Temperature", unit_of_measurement: "°C" } },
  { entity_id: entities.humidity, state: "43.2", attributes: { friendly_name: "Aranet Radon Humidity", unit_of_measurement: "%" } },
  { entity_id: entities.pressure, state: "885.10", attributes: { friendly_name: "Aranet Radon Pressure", unit_of_measurement: "hPa" } },
  { entity_id: entities.battery, state: "96", attributes: { friendly_name: "Aranet Radon Battery", unit_of_measurement: "%" } },
];

describe("Home Assistant Aranet client", () => {
  test("discovers a complete Aranet Radon entity group", async () => {
    const requests: Request[] = [];
    const devices = await discoverAranetDevices(
      new URL("https://ha.example.com/"),
      "secret",
      async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json(states);
      },
    );

    expect(devices).toEqual([
      {
        name: "Aranet Radon",
        prefix: "sensor.aranetrn_38b33",
        entities,
      },
    ]);
    expect(requests[0]?.url).toBe("https://ha.example.com/api/states");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer secret");
  });

  test("ignores incomplete sensor groups", async () => {
    const devices = await discoverAranetDevices(
      new URL("https://ha.example.com/"),
      "secret",
      async () => Response.json(states.filter((state) => state.entity_id !== entities.battery)),
    );

    expect(devices).toEqual([]);
  });

  test("fetches and normalizes live readings", async () => {
    const byEntity = new Map(states.map((state) => [state.entity_id, state]));
    const reading = await fetchAranetReading(
      new URL("https://ha.example.com/"),
      "secret",
      { name: "Basement Radon", prefix: "sensor.aranetrn_38b33", entities },
      async (input) => {
        const entityId = decodeURIComponent(
          new URL(input instanceof Request ? input.url : input).pathname
            .split("/")
            .at(-1) ?? "",
        );
        const state = byEntity.get(entityId);
        return state ? Response.json(state) : new Response("missing", { status: 404 });
      },
      new Date("2026-07-29T21:00:00Z"),
    );

    expect(reading).toEqual({
      deviceName: "Basement Radon",
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
    });
  });

  test("fails clearly when Home Assistant rejects authentication", async () => {
    expect(
      discoverAranetDevices(
        new URL("https://ha.example.com/"),
        "bad-token",
        async () => new Response("Unauthorized", { status: 401 }),
      ),
    ).rejects.toThrow("authentication");
  });

  test("rejects unavailable and nonnumeric measurements", async () => {
    const invalidStates = new Map(states.map((state) => [state.entity_id, state]));
    invalidStates.set(entities.radon, {
      entity_id: entities.radon,
      state: "unavailable",
      attributes: { friendly_name: "Aranet Radon Radon concentration", unit_of_measurement: "Bq/m³" },
    });

    expect(
      fetchAranetReading(
        new URL("https://ha.example.com/"),
        "secret",
        { name: "Aranet Radon", prefix: "sensor.aranetrn_38b33", entities },
        async (input) => {
          const entityId = decodeURIComponent(
            new URL(input instanceof Request ? input.url : input).pathname
              .split("/")
              .at(-1) ?? "",
          );
          return Response.json(invalidStates.get(entityId));
        },
      ),
    ).rejects.toThrow(entities.radon);
  });
});
