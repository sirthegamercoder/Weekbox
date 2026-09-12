import { appSettings } from "../core/system/settings.service.js";

const ENGINE_ORDER_KEY = "weekbox_engine_order";

export const DEFAULT_ENGINE_ORDER = [
  "vslice",
  "codename",
  "psych",
  "pslice",
  "fpsplus",
  "psychonline",
];

function readJsonSetting(key, fallback) {
  try {
    const value = JSON.parse(appSettings.get(key));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function readEngineOrder() {
  try {
    const value = JSON.parse(localStorage.getItem(ENGINE_ORDER_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function getEngineOrder(availableIds = DEFAULT_ENGINE_ORDER) {
  const available = [...new Set(availableIds)];
  const saved = [...new Set(readEngineOrder())];
  return [...new Set([...saved, ...DEFAULT_ENGINE_ORDER, ...available])].filter(
    (id) => available.includes(id),
  );
}

export function setEngineOrder(order) {
  try {
    localStorage.setItem(ENGINE_ORDER_KEY, JSON.stringify([...new Set(order)]));
  } catch {}
}

export function getEngineVersionOrder(engineId, versions) {
  const available = [...new Set(versions)];
  const preferences = readJsonSetting("engineVersionPreferences", {});
  const saved = Array.isArray(preferences[engineId]?.order)
    ? preferences[engineId].order
    : [];
  return [...new Set([...saved, ...available])].filter((version) =>
    available.includes(version),
  );
}

export function setEngineVersionOrder(engineId, order) {
  const preferences = readJsonSetting("engineVersionPreferences", {});
  preferences[engineId] = {
    ...preferences[engineId],
    order: [...new Set(order)],
  };
  appSettings.set("engineVersionPreferences", JSON.stringify(preferences));
}

export function getPreferredEngineVersion(engineId, versions) {
  const orderedVersions = getEngineVersionOrder(engineId, versions);
  const preferences = readJsonSetting("engineVersionPreferences", {});
  const preferred = preferences[engineId]?.preferred;
  return orderedVersions.includes(preferred)
    ? preferred
    : orderedVersions[0] || null;
}

export function setPreferredEngineVersion(engineId, version) {
  const preferences = readJsonSetting("engineVersionPreferences", {});
  preferences[engineId] = {
    ...preferences[engineId],
    preferred: version || null,
  };
  appSettings.set("engineVersionPreferences", JSON.stringify(preferences));
}

export function getEngineVersionName(engineId, version, fallback) {
  const preferences = readJsonSetting("engineVersionPreferences", {});
  const name = preferences[engineId]?.names?.[version];
  return typeof name === "string" && name.trim() ? name.trim() : fallback;
}

export function setEngineVersionName(engineId, version, name, fallback) {
  const preferences = readJsonSetting("engineVersionPreferences", {});
  const enginePreferences = preferences[engineId] || {};
  const names = { ...(enginePreferences.names || {}) };
  const trimmedName = String(name || "")
    .trim()
    .slice(0, 80);
  if (!trimmedName || trimmedName === fallback) delete names[version];
  else names[version] = trimmedName;
  if (Object.keys(names).length) enginePreferences.names = names;
  else delete enginePreferences.names;
  preferences[engineId] = enginePreferences;
  appSettings.set("engineVersionPreferences", JSON.stringify(preferences));
}
