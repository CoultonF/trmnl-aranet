export interface AranetEntities {
  radon: string;
  threshold: string;
  temperature: string;
  humidity: string;
  pressure: string;
  battery: string;
}

export interface AranetDevice {
  name: string;
  prefix: string;
  entities: AranetEntities;
}

export interface AranetReading {
  deviceName: string;
  radon: number;
  radonUnit: string;
  threshold: string;
  temperature: number;
  temperatureUnit: string;
  humidity: number;
  humidityUnit: string;
  pressure: number;
  pressureUnit: string;
  battery: number;
  batteryUnit: string;
  observedAt: string;
  stale: boolean;
}

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface HomeAssistantState {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    unit_of_measurement?: string;
  };
}

async function requestStateJson(
  url: URL,
  token: string,
  fetcher: Fetch,
): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("Home Assistant authentication failed");
  }
  if (!response.ok) {
    throw new Error(`Home Assistant request failed with HTTP ${response.status}`);
  }
  return response.json();
}

function parseState(value: unknown, expectedEntityId?: string): HomeAssistantState {
  if (
    typeof value !== "object" ||
    value === null ||
    !("entity_id" in value) ||
    typeof value.entity_id !== "string" ||
    !("state" in value) ||
    typeof value.state !== "string" ||
    !("attributes" in value) ||
    typeof value.attributes !== "object" ||
    value.attributes === null
  ) {
    throw new Error("Home Assistant returned an invalid state");
  }
  if (expectedEntityId && value.entity_id !== expectedEntityId) {
    throw new Error(`Home Assistant returned the wrong entity for ${expectedEntityId}`);
  }
  return value as HomeAssistantState;
}

function numericState(state: HomeAssistantState): number {
  const number = Number(state.state);
  if (!Number.isFinite(number)) {
    throw new Error(`Home Assistant entity ${state.entity_id} is unavailable or nonnumeric`);
  }
  return number;
}

export async function discoverAranetDevices(
  baseUrl: URL,
  token: string,
  fetcher: Fetch,
): Promise<AranetDevice[]> {
  const payload = await requestStateJson(
    new URL("/api/states", baseUrl),
    token,
    fetcher,
  );
  if (!Array.isArray(payload)) {
    throw new Error("Home Assistant states response is invalid");
  }

  const states = payload.map((value) => parseState(value));
  const stateByEntityId = new Map(states.map((state) => [state.entity_id, state]));
  const devices: AranetDevice[] = [];

  for (const radonState of states) {
    const match = /^(sensor\..+)_radon_concentration$/.exec(radonState.entity_id);
    if (!match?.[1]) {
      continue;
    }

    const prefix = match[1];
    const entities: AranetEntities = {
      radon: radonState.entity_id,
      threshold: `${prefix}_threshold`,
      temperature: `${prefix}_temperature`,
      humidity: `${prefix}_humidity`,
      pressure: `${prefix}_pressure`,
      battery: `${prefix}_battery`,
    };
    if (Object.values(entities).some((entityId) => !stateByEntityId.has(entityId))) {
      continue;
    }

    const friendlyName =
      radonState.attributes.friendly_name ?? prefix.slice("sensor.".length);
    devices.push({
      name: friendlyName.replace(/\s+radon concentration$/i, ""),
      prefix,
      entities,
    });
  }

  return devices;
}

export async function fetchAranetReading(
  baseUrl: URL,
  token: string,
  device: AranetDevice,
  fetcher: Fetch,
  now = new Date(),
): Promise<AranetReading> {
  const entityIds = Object.values(device.entities);
  const states = await Promise.all(
    entityIds.map(async (entityId) =>
      parseState(
        await requestStateJson(
          new URL(`/api/states/${encodeURIComponent(entityId)}`, baseUrl),
          token,
          fetcher,
        ),
        entityId,
      ),
    ),
  );
  const stateByEntityId = new Map(states.map((state) => [state.entity_id, state]));
  const get = (entityId: string): HomeAssistantState => {
    const state = stateByEntityId.get(entityId);
    if (!state) {
      throw new Error(`Home Assistant omitted entity ${entityId}`);
    }
    return state;
  };

  const radon = get(device.entities.radon);
  const temperature = get(device.entities.temperature);
  const humidity = get(device.entities.humidity);
  const pressure = get(device.entities.pressure);
  const battery = get(device.entities.battery);

  return {
    deviceName: device.name,
    radon: numericState(radon),
    radonUnit: radon.attributes.unit_of_measurement ?? "Bq/m³",
    threshold: get(device.entities.threshold).state,
    temperature: numericState(temperature),
    temperatureUnit: temperature.attributes.unit_of_measurement ?? "°C",
    humidity: numericState(humidity),
    humidityUnit: humidity.attributes.unit_of_measurement ?? "%",
    pressure: numericState(pressure),
    pressureUnit: pressure.attributes.unit_of_measurement ?? "hPa",
    battery: numericState(battery),
    batteryUnit: battery.attributes.unit_of_measurement ?? "%",
    observedAt: now.toISOString(),
    stale: false,
  };
}
