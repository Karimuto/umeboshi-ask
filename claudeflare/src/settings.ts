// S12: settings export/import (move to another device). Export all settings
// from the account tab to the Cloud, import on another device to restore. Anon
// is out of scope (button hidden on the front, login prompt). KV keys live under
// `ask:settings:{userId}` so they never collide with Thread/index/credits/auth.
// PRD §6: KV holds "settings", on keys separate from saved Message/Thread.
import type { AuthStore } from "./stores";
import { isEffortValue } from "./models";

export const SETTINGS_KEY_PREFIX = "ask:settings:";
/** Settings KV TTL (10 years like S6 ThreadStore = effectively forever. Avoids memoryStore expiry). */
export const SETTINGS_TTL_SEC = 10 * 365 * 24 * 60 * 60;
export const SETTINGS_MAX_BYTES = 200 * 1024;
/** Max customs (front allows unlimited adds, Cloud storage caps here). */
export const SETTINGS_CUSTOMS_MAX = 100;
/** Label max (practical range of the front input). */
export const SETTINGS_LABEL_MAX = 200;
/** Prompt body max (matches 20,000 chars per Message). */
export const SETTINGS_BODY_MAX = 20_000;

export function settingsKey(userId: string): string {
  return `${SETTINGS_KEY_PREFIX}${userId}`;
}

export interface StoredPrompt {
  label: string;
  body: string;
}

export interface StoredCustom {
  id: string;
  label: string;
  body: string;
}

export interface StoredSettings {
  version: 1;
  sendMode: "button" | "enter";
  lang: "auto" | "ja" | "en";
  prompts: Record<"why" | "what" | "significance" | "origin" | "eli5", StoredPrompt>;
  customs: StoredCustom[];
  /** #66 Per-model effort memory {modelId: effort}. Moves with device transfer. */
  efforts: Record<string, string>;
}

export interface StoredSettingsRecord {
  settings: StoredSettings;
  updatedAt: string;
}

const DEFAULT_KEYS = ["why", "what", "significance", "origin", "eli5"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clampStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  if (v.length > max) return null;
  return v;
}

/**
 * Re-run the front mergeSettings normalization on the server side.
 * Type/limit violations return null (400/413). Missing keys fail too (front always sends all).
 */
export function normalizeSettings(input: unknown): StoredSettings | null {
  if (!isRecord(input)) return null;
  const out: StoredSettings = {
    version: 1,
    sendMode: "button",
    lang: "auto",
    prompts: {
      why: { label: "", body: "" },
      what: { label: "", body: "" },
      significance: { label: "", body: "" },
      origin: { label: "", body: "" },
      eli5: { label: "", body: "" },
    },
    customs: [],
    efforts: {},
  };
  const sendMode = (input as Record<string, unknown>)["sendMode"];
  if (sendMode === "enter" || sendMode === "button") {
    out.sendMode = sendMode;
  } else if (sendMode !== undefined) {
    return null;
  }
  const lang = (input as Record<string, unknown>)["lang"];
  if (lang === "auto" || lang === "ja" || lang === "en") {
    out.lang = lang;
  } else if (lang !== undefined) {
    return null;
  }
  const prompts = (input as Record<string, unknown>)["prompts"];
  if (prompts !== undefined) {
    if (!isRecord(prompts)) return null;
    for (const k of DEFAULT_KEYS) {
      const p = (prompts as Record<string, unknown>)[k];
      if (p === undefined) return null;
      if (!isRecord(p)) return null;
      const label = clampStr(p["label"], SETTINGS_LABEL_MAX);
      const body = clampStr(p["body"], SETTINGS_BODY_MAX);
      if (label === null || body === null || body === "") return null;
      out.prompts[k] = { label, body };
    }
  } else {
    return null;
  }
  const customs = (input as Record<string, unknown>)["customs"];
  if (customs !== undefined) {
    if (!Array.isArray(customs)) return null;
    if (customs.length > SETTINGS_CUSTOMS_MAX) return null;
    const seen = new Set<string>();
    for (const c of customs) {
      if (!isRecord(c)) return null;
      const id = c["id"];
      const label = clampStr(c["label"], SETTINGS_LABEL_MAX);
      const body = clampStr(c["body"], SETTINGS_BODY_MAX);
      if (typeof id !== "string" || id === "" || id.length > 64) return null;
      if (label === null || body === null || body === "") return null;
      if (seen.has(id)) return null;
      seen.add(id);
      out.customs.push({ id, label, body });
    }
  } else {
    return null;
  }
  const efforts = (input as Record<string, unknown>)["efforts"];
  if (efforts !== undefined) {
    if (!isRecord(efforts)) return null;
    const keys = Object.keys(efforts);
    if (keys.length > 100) return null;
    for (const k of keys) {
      if (k === "" || k.length > 200) return null;
      const v = (efforts as Record<string, unknown>)[k];
      if (typeof v !== "string" || !isEffortValue(v)) return null;
      out.efforts[k] = v;
    }
  } else {
    return null;
  }
  return out;
}

export async function getSettings(
  store: AuthStore,
  userId: string,
): Promise<StoredSettingsRecord | null> {
  const raw = await store.get(settingsKey(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSettingsRecord;
    if (!isRecord(parsed) || typeof parsed["updatedAt"] !== "string") return null;
    const settings = normalizeSettings(parsed["settings"]);
    if (!settings) return null;
    return { settings, updatedAt: parsed["updatedAt"] as string };
  } catch {
    return null;
  }
}

export async function putSettings(
  store: AuthStore,
  userId: string,
  input: unknown,
  nowIso: string = new Date().toISOString(),
): Promise<StoredSettingsRecord | null> {
  const settings = normalizeSettings(input);
  if (!settings) return null;
  if (JSON.stringify(settings).length > SETTINGS_MAX_BYTES) return null;
  const record: StoredSettingsRecord = { settings, updatedAt: nowIso };
  await store.put(settingsKey(userId), JSON.stringify(record), SETTINGS_TTL_SEC);
  return record;
}
