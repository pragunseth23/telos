import { safeJsonParse } from "./utils.js";

const DEFAULT_STORAGE_KEY = "telos.state.v1";
let fallbackState = null;

function hasLocalStorage() {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

export class MemoryStore {
  constructor(storageKey = DEFAULT_STORAGE_KEY) {
    this.storageKey = storageKey;
  }

  load() {
    if (hasLocalStorage()) {
      const rawValue = window.localStorage.getItem(this.storageKey);
      if (!rawValue) {
        return null;
      }

      return safeJsonParse(rawValue, null);
    }

    return fallbackState;
  }

  save(state) {
    if (hasLocalStorage()) {
      window.localStorage.setItem(this.storageKey, JSON.stringify(state));
      return;
    }

    fallbackState = state;
  }

  clear() {
    if (hasLocalStorage()) {
      window.localStorage.removeItem(this.storageKey);
      return;
    }

    fallbackState = null;
  }
}
