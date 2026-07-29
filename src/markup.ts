import type { AranetReading } from "./home-assistant.ts";

export interface TrmnlRenderContext {
  instanceName: string;
  locale: string;
  timeZone: string;
}

export interface TrmnlLayouts {
  markup: string;
  markup_half_horizontal: string;
  markup_half_vertical: string;
  markup_quadrant: string;
  shared: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderPluginLayouts(
  reading: AranetReading,
  context: TrmnlRenderContext,
): TrmnlLayouts {
  const formatNumber = new Intl.NumberFormat(context.locale, {
    maximumFractionDigits: 2,
  });
  let observedAt: string;
  try {
    observedAt = new Intl.DateTimeFormat(context.locale, {
      timeZone: context.timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(reading.observedAt));
  } catch {
    observedAt = reading.observedAt;
  }

  const deviceName = escapeHtml(reading.deviceName);
  const instanceName = escapeHtml(context.instanceName);
  const radon = formatNumber.format(reading.radon);
  const threshold = escapeHtml(reading.threshold.toUpperCase());
  const freshness = reading.stale ? "STALE" : `Updated ${escapeHtml(observedAt)}`;
  const emphasisByThreshold: Record<string, string> = {
    green: "item--emphasis-1",
    yellow: "item--emphasis-2",
    red: "item--emphasis-3",
    error: "item--emphasis-3",
  };
  const emphasis = emphasisByThreshold[reading.threshold.toLowerCase()] ?? "item--emphasis-2";
  const metrics = [
    ["Temperature", reading.temperature, reading.temperatureUnit],
    ["Humidity", reading.humidity, reading.humidityUnit],
    ["Pressure", reading.pressure, reading.pressureUnit],
    ["Battery", reading.battery, reading.batteryUnit],
  ]
    .map(
      ([label, value, unit]) => `
        <div class="item">
          <div class="content">
            <span class="value value--small value--tnums">${formatNumber.format(value as number)} ${escapeHtml(unit as string)}</span>
            <span class="label">${label}</span>
          </div>
        </div>`,
    )
    .join("");
  const titleBar = `
    <div class="title_bar">
      <span class="title">Aranet Radon</span>
      <span class="instance">${instanceName}</span>
    </div>`;
  const status = `
    <div class="item ${emphasis}">
      <div class="meta"></div>
      <div class="content">
        <span class="value value--small">${threshold}</span>
        <span class="label">Threshold</span>
      </div>
    </div>`;

  return {
    markup: `<div class="view view--full">
      <div class="layout layout--col gap--medium">
        <span class="title">${deviceName}</span>
        <div class="grid grid--cols-2 gap--large">
          <div class="item ${emphasis}">
            <div class="meta"></div>
            <div class="content">
              <span class="value value--giga value--tnums">${radon}</span>
              <span class="label">${escapeHtml(reading.radonUnit)} · Radon concentration</span>
            </div>
          </div>
          ${status}
        </div>
        <div class="grid grid--cols-4 gap--medium">${metrics}</div>
        <span class="label">${freshness}</span>
      </div>
      ${titleBar}
    </div>`,
    markup_half_horizontal: `<div class="view view--half_horizontal">
      <div class="layout">
        <div class="grid grid--cols-2 gap--medium">
          <div class="item ${emphasis}">
            <div class="meta"></div>
            <div class="content">
              <span class="value value--mega value--tnums">${radon}</span>
              <span class="label">${escapeHtml(reading.radonUnit)} · ${threshold}</span>
            </div>
          </div>
          <div class="grid grid--cols-2 gap--small">${metrics}</div>
        </div>
        <span class="label">${freshness}</span>
      </div>
      ${titleBar}
    </div>`,
    markup_half_vertical: `<div class="view view--half_vertical">
      <div class="layout layout--col gap--medium">
        <span class="title">${deviceName}</span>
        <div class="item ${emphasis}">
          <div class="meta"></div>
          <div class="content">
            <span class="value value--mega value--tnums">${radon}</span>
            <span class="label">${escapeHtml(reading.radonUnit)} · ${threshold}</span>
          </div>
        </div>
        <div class="grid grid--cols-2 gap--small">${metrics}</div>
        <span class="label">${freshness}</span>
      </div>
      ${titleBar}
    </div>`,
    markup_quadrant: `<div class="view view--quadrant">
      <div class="layout layout--col gap--small">
        <span class="value value--xxlarge value--tnums">${radon}</span>
        <span class="label">${escapeHtml(reading.radonUnit)} · ${threshold}</span>
        <div class="grid grid--cols-2 gap--small">
          <span class="value value--xsmall">${formatNumber.format(reading.temperature)} ${escapeHtml(reading.temperatureUnit)}</span>
          <span class="value value--xsmall">${formatNumber.format(reading.humidity)} ${escapeHtml(reading.humidityUnit)}</span>
        </div>
        <span class="label">${freshness}</span>
      </div>
      ${titleBar}
    </div>`,
    shared: "",
  };
}
