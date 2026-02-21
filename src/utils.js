export function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function splitList(rawValue) {
  if (!rawValue || typeof rawValue !== "string") {
    return [];
  }

  return rawValue
    .split(/\n|,|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function safeJsonParse(rawValue, fallbackValue) {
  try {
    return JSON.parse(rawValue);
  } catch {
    return fallbackValue;
  }
}

export function normalize(rawValue) {
  return (rawValue || "").trim().toLowerCase();
}

export function formatDateTime(rawValue) {
  if (!rawValue) {
    return "-";
  }

  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    return rawValue;
  }

  return `${parsed.toLocaleDateString()} ${parsed.toLocaleTimeString()}`;
}
