import { describe, expect, test } from "bun:test";
import { renderPluginLayouts } from "../src/markup.ts";
import type { AranetReading } from "../src/home-assistant.ts";

const reading: AranetReading = {
  deviceName: "Basement <Radon>",
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

describe("TRMNL layouts", () => {
  test("renders every marketplace layout with framework root classes", () => {
    const layouts = renderPluginLayouts(reading, {
      instanceName: "Home",
      locale: "en-CA",
      timeZone: "America/Edmonton",
    });

    expect(layouts.markup).toContain('class="view view--full"');
    expect(layouts.markup_half_horizontal).toContain('class="view view--half_horizontal"');
    expect(layouts.markup_half_vertical).toContain('class="view view--half_vertical"');
    expect(layouts.markup_quadrant).toContain('class="view view--quadrant"');
    expect(layouts.shared).toBe("");
  });

  test("shows radon and supporting readings without relying on color", () => {
    const layouts = renderPluginLayouts(reading, {
      instanceName: "Home",
      locale: "en-CA",
      timeZone: "America/Edmonton",
    });

    expect(layouts.markup).toContain(">50<");
    expect(layouts.markup).toContain("Bq/m³");
    expect(layouts.markup).toContain("GREEN");
    expect(layouts.markup).toContain("21.2 °C");
    expect(layouts.markup).toContain("43.2 %");
    expect(layouts.markup).toContain("885.1 hPa");
    expect(layouts.markup).toContain("96 %");
  });

  test("escapes user-controlled labels", () => {
    const layouts = renderPluginLayouts(reading, {
      instanceName: '<img src=x onerror="alert(1)">',
      locale: "en-CA",
      timeZone: "America/Edmonton",
    });

    expect(layouts.markup).not.toContain("<Radon>");
    expect(layouts.markup).not.toContain("<img");
    expect(layouts.markup).toContain("Basement &lt;Radon&gt;");
    expect(layouts.markup).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  test("marks cached data as stale in every layout", () => {
    const layouts = renderPluginLayouts(
      { ...reading, stale: true },
      { instanceName: "Home", locale: "en-CA", timeZone: "America/Edmonton" },
    );

    for (const markup of [
      layouts.markup,
      layouts.markup_half_horizontal,
      layouts.markup_half_vertical,
      layouts.markup_quadrant,
    ]) {
      expect(markup).toContain("STALE");
    }
  });
});
