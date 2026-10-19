// S8: model selection source is the HOST KV allowlist; OpenRouter inventory is a cron daily cache.
// OSS boundary (ADR 0002): prices here are public USD guide prices only. Credit
// formulas, margins, and balance checks live in the HOST vault (S10).
// selectable/credits come from the HOST overlay; missing means selectable.
// Self-host runs on the fixed 5-model bundle.
/** #66 Effort (OpenRouter reasoning.effort) choices. Lineup differs per model. */
export const EFFORT_VALUES = ["max", "xhigh", "high", "medium", "low", "minimal", "none"] as const;
export type EffortValue = (typeof EFFORT_VALUES)[number];
const EFFORT_KNOWN: Record<string, true> = { max: true, xhigh: true, high: true, medium: true, low: true, minimal: true, none: true };
export function isEffortValue(v: unknown): v is EffortValue {
  return typeof v === "string" && EFFORT_KNOWN[v] === true;
}
/** Normalize OpenRouter reasoning.supported_efforts. Drop unknowns; empty is null (no-choice). Keeps receive order. */
export function parseSupportedEfforts(raw: unknown): EffortValue[] | null {
  if (!Array.isArray(raw)) return null;
  const out: EffortValue[] = [];
  for (const v of raw) {
    if (isEffortValue(v) && !out.includes(v)) out.push(v);
  }
  return out.length > 0 ? out : null;
}
export interface AskModel {
  id: string;
  name: string;
  /** Public guide price ($/1M tokens, prompt). For cheapest-first sort. Unknown is Infinity. */
  priceUsdPer1M: number;
  /** Reserved amount (credits/question). BUNDLE follows the 2026-10-06 OpenRouter measurement. Unknown inventory ids stay missing and fall to estimate. */
  credits?: number;
  /** AA-Omniscience Index (guide, -100 to 100, rounded int). 0 means unmeasured and hidden. No source links (#72 Q6/Q9). */
  smartScore: number;
  /** #198 Per-effort smart-score values (AA-Omniscience Index, rounded int).
   *  Only measured efforts are listed. Missing efforts are omitted (panel shows `—`). */
  scores?: Partial<Record<EffortValue, number>>;
  /** #66 Available lineup. Empty/missing means no choice (no effort UI, sends nothing). */
  supportedEfforts: readonly EffortValue[];
  /** #66 Default when unspecified. Falls back as described below (medium, then first). */
  defaultEffort: EffortValue | null;
  /** #66 True blocks none (OpenRouter mandatory). */
  reasoningMandatory: boolean;
  /** Image input support. Derived from inventory architecture input modality. Bundle defaults true. */
  supportsImages: boolean;
}

export interface ResolvedModel extends AskModel {
  /** False on low balance (attached by HOST/S10). Missing/true = selectable. */
  selectable: boolean;
  /** Reserved amount (credits/question). BUNDLE carries measured values; missing falls to estimate. */
  credits?: number;
}
/** #66 Value sent when unspecified. Default effort when valid, else medium, else first. No-choice models are null. */
export function defaultEffortFor(model: Pick<AskModel, "supportedEfforts" | "defaultEffort">): EffortValue | null {
  const supported = model.supportedEfforts ?? [];
  if (supported.length === 0) return null;
  if (model.defaultEffort && (supported as readonly string[]).includes(model.defaultEffort)) return model.defaultEffort;
  if ((supported as readonly string[]).includes("medium")) return "medium";
  return supported[0] ?? null;
}
/** #66 Whether the value is valid for the model. Mandatory models reject none. No-choice models reject all. */
export function isValidEffortForModel(
  model: Pick<AskModel, "supportedEfforts" | "reasoningMandatory">,
  effort: unknown,
): effort is EffortValue {
  if (!isEffortValue(effort)) return false;
  const supported = model.supportedEfforts ?? [];
  if (!(supported as readonly string[]).includes(effort)) return false;
  if (effort === "none" && model.reasoningMandatory) return false;
  return true;
 }

/** Fixed 5-model bundle for self-host (ADR 0015).
 * Definition order = cheapest first. Runs on the single OpenRouter line.
 * Prices are public USD guide prices (prompt $/1M. Measured 2026-09-23).
 * smartScore is the AA-Omniscience Index rounded to int (measured 2026-09-28. Per-model max thinking-level row).
 * Opus 46 (max 46.42/xhigh 42.65/high 40.63/medium 40.32/low 38.87),
 * mimo-v2.6-pro 8 (8.38), glm-5.3-flash 7 (7.47. Plain GLM-5.3 max 14.3 is a different model, so excluded),
 * gemini-3.8-flash 30 (high 29.55/medium 28.58/low 21.35. No max row),
 * mimo-v2.5 -10 (-9.83. mimo-v2-5-pro 3.25 is a different model, so excluded).
 * #198 scores are the per-effort values from the same measurement (rounded int). Unmeasured efforts are omitted and the panel shows `—`.
 * Opus max 46 / xhigh 43 / high 41 / medium 40 / low 39,
 * gemini-3.8-flash high 30 / medium 29 / low 21 (no max row),
 * glm-5.3-flash has max 7 only (no high/low measurement for that model, so omitted),
 * mimo-v2.6-pro offers no effort choice, so it has no scores.
 * Real-usage settle belongs to #166. This bundle's credits are the reserved-amount source of truth.
 * Rewrite needs no redeploy: put an id-array JSON to KV ask:models:allowlist:v1 for instant effect
 * (npx wrangler kv:key put --binding=UMEBOSHI_KV "ask:models:allowlist:v1" '["xiaomi/mimo-v2.5",...]'). */
export const BUNDLE_MODELS: readonly AskModel[] = [
  { id: "xiaomi/mimo-v2.5", name: "Xiaomi: MiMo-V2.5", priceUsdPer1M: 0.14, credits: 1, smartScore: -10, supportedEfforts: [], defaultEffort: null, reasoningMandatory: false, supportsImages: true },
  { id: "z-ai/glm-5.3-flash", name: "Z.ai: GLM 5.3 Flash", priceUsdPer1M: 0.15, credits: 1, smartScore: 7, scores: { max: 7 }, supportedEfforts: ["max", "high", "low"], defaultEffort: "max", reasoningMandatory: true, supportsImages: true },
  { id: "xiaomi/mimo-v2.6-pro", name: "Xiaomi: MiMo-V2.6-Pro", priceUsdPer1M: 0.435, credits: 1, smartScore: 8, supportedEfforts: [], defaultEffort: null, reasoningMandatory: false, supportsImages: true },
  { id: "google/gemini-3.8-flash", name: "Google: Gemini 3.8 Flash", priceUsdPer1M: 0.75, credits: 6, smartScore: 30, scores: { high: 30, medium: 29, low: 21 }, supportedEfforts: ["high", "medium", "low"], defaultEffort: "medium", reasoningMandatory: true, supportsImages: true },
  { id: "anthropic/claude-opus-5.5", name: "Anthropic: Claude Opus 5.5", priceUsdPer1M: 4.0, credits: 31, smartScore: 46, scores: { max: 46, xhigh: 43, high: 41, medium: 40, low: 39 }, supportedEfforts: ["max", "xhigh", "high", "medium", "low"], defaultEffort: "high", reasoningMandatory: true, supportsImages: true },
] as const;

/** #198 Four tiers (ModelTier). Tier names match the site/ model classes (basic/middle/premium) plus top ultra.
 *  Each tier is one (modelId, effort) pair. Effort is null for no-choice models. */
export interface ModelPreset { tier: "basic" | "middle" | "premium" | "ultra"; modelId: string; effort: EffortValue | null; }
export const MODEL_PRESETS: readonly ModelPreset[] = [
  { tier: "basic",   modelId: "xiaomi/mimo-v2.6-pro",   effort: null },
  { tier: "middle",  modelId: "google/gemini-3.8-flash", effort: "medium" },
  { tier: "premium", modelId: "anthropic/claude-opus-5.5", effort: "high" },
  { tier: "ultra",   modelId: "anthropic/claude-opus-5.5", effort: "max" },
] as const;

export const ALLOWLIST_KEY = "ask:models:allowlist:v1";
export const MODELS_CACHE_KEY = "ask:models:cache:v1";
export const MODELS_AUDIT_KEY = "ask:models:audit:v1";
export const MODELS_CACHE_TTL_SEC = 24 * 60 * 60;
export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

export interface ModelStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  del(key: string): Promise<void>;
}

export function kvModelStore(kv: KVNamespace): ModelStore {
  return {
    get: (k) => kv.get(k),
    put: (k, v, o) =>
      o?.expirationTtl ? kv.put(k, v, { expirationTtl: o.expirationTtl }) : kv.put(k, v),
    del: (k) => kv.delete(k),
  };
}

/** Test/KV-less dev store. No TTL replay (purge/read behavior only). */
export function memoryModelStore(): ModelStore {
  const m = new Map<string, string>();
  return {
    get: async (k) => (m.has(k) ? (m.get(k) as string) : null),
    put: async (k, v) => {
      m.set(k, v);
    },
    del: async (k) => {
      m.delete(k);
    },
  };
}

/** Cheapest first. Unknown prices go last. Stable sort keeps input order on ties. */
export function sortCheapFirst<T extends { priceUsdPer1M: number }>(models: readonly T[]): T[] {
  return [...models].sort((a, b) => {
    const pa = Number.isFinite(a.priceUsdPer1M) ? a.priceUsdPer1M : Number.POSITIVE_INFINITY;
    const pb = Number.isFinite(b.priceUsdPer1M) ? b.priceUsdPer1M : Number.POSITIVE_INFINITY;
    return pa - pb;
  });
}

/**
 * Pure function attaching unselectable for low-balance models (S10 joins balance).
 * Unknown balance (null) or unknown-credits models stay selectable.
 */
export function markSelectable<T extends { credits?: number }>(
  models: readonly T[],
  balanceCredits: number | null | undefined,
): (T & { selectable: boolean })[] {
  return models.map((m) => ({
    ...m,
    selectable: balanceCredits == null || m.credits == null || m.credits <= balanceCredits,
  }));
}

/** First selectable, cheapest first. Null when none. */
export function cheapestSelectable(models: readonly ResolvedModel[]): ResolvedModel | null {
  for (const m of sortCheapFirst(models)) {
    if (m.selectable !== false) return m;
  }
  return null;
}

/**
 * S9: first selectable below the current model, cheapest first. Null when none.
 * One-shot target after 15s of total silence. Skips unselectable (selectable:false).
 */
export function nextFallbackModel(
  models: readonly ResolvedModel[],
  currentId: string,
): ResolvedModel | null {
  for (const m of sortCheapFirst(models)) {
    if (m.id !== currentId && m.selectable !== false) return m;
  }
  return null;
}

export interface CachedInventoryModel {
  id: string;
  name: string;
  priceUsdPer1M: number;
  /** #66 Lineup. Missing/empty means no choice. Old cache (unmarked) reads as missing. */
  supportedEfforts?: EffortValue[];
  /** #66 Default when unspecified. Invalid values are never sent; fall back instead. */
  defaultEffort?: EffortValue | null;
  /** #66 True blocks none. Missing reads as false. */
  reasoningMandatory?: boolean;
  /** Image input support. Derived from inventory architecture input modality. Missing reads as false. */
  supportsImages?: boolean;
}

export interface ModelCache {
  updatedAt: string;
  models: CachedInventoryModel[];
}

/** #66 Pick lineup/default/required from the OpenRouter reasoning object. Broken is empty (no-choice). */
export function parseReasoningMeta(raw: unknown): {
  supportedEfforts: EffortValue[];
  defaultEffort: EffortValue | null;
  reasoningMandatory: boolean;
} {
  const empty = { supportedEfforts: [] as EffortValue[], defaultEffort: null as EffortValue | null, reasoningMandatory: false };
  if (typeof raw !== "object" || raw === null) return empty;
  if (!("supported_efforts" in raw) && !("default_effort" in raw) && !("mandatory" in raw)) return empty;
  const holder = raw as unknown as Record<string, unknown>;
  const supported = parseSupportedEfforts(holder["supported_efforts"]) ?? [];
  if (supported.length === 0) return empty;
  const defRaw = holder["default_effort"];
  const def = isEffortValue(defRaw) && supported.includes(defRaw) ? defRaw : null;
  return { supportedEfforts: supported, defaultEffort: def, reasoningMandatory: holder["mandatory"] === true };
}

interface InventoryEntry {
  id?: unknown;
  name?: unknown;
  pricing?: unknown;
  reasoning?: unknown;
  architecture?: unknown;
}
/** Derive image support from inventory architecture input modality. Only image entries read true. */
export function parseImageModality(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const holder = raw as Record<string, unknown>;
  const input = holder["input"];
  const modalities = Array.isArray(input) ? input : holder["input_modalities"];
  if (!Array.isArray(modalities)) return false;
  return modalities.some((m) => m === "image");
}


function entryPrice(entry: InventoryEntry): number {
  const pricing = entry.pricing;
  if (typeof pricing !== "object" || pricing === null || !("prompt" in pricing)) return Number.POSITIVE_INFINITY;
  const prompt = (pricing as { prompt?: unknown }).prompt;
  const price =
    typeof prompt === "string"
      ? Number.parseFloat(prompt) * 1_000_000
      : typeof prompt === "number"
        ? prompt * 1_000_000
        : Number.NaN;
  return Number.isFinite(price) ? price : Number.POSITIVE_INFINITY;
}

/** Pick only the data array of OpenRouter GET /models. Drop broken entries. */
export function parseInventoryPayload(payload: unknown): CachedInventoryModel[] {
  if (typeof payload !== "object" || payload === null || !("data" in payload)) return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const out: CachedInventoryModel[] = [];
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as InventoryEntry;
    if (typeof entry.id !== "string" || entry.id === "") continue;
    const name = typeof entry.name === "string" && entry.name !== "" ? entry.name : entry.id;
    const reasoning = parseReasoningMeta(entry.reasoning);
    const supportsImages = parseImageModality(entry.architecture);
    out.push({ id: entry.id, name, priceUsdPer1M: entryPrice(entry), ...reasoning, supportsImages });
  }
  return out;
}

/**
 * Save OpenRouter inventory to KV with 24h TTL (for cron-daily + delayed refetch after purge).
 * On fetch failure return null and keep the existing stale cache.
 */
export async function refreshModelCache(
  store: ModelStore,
  fetchFn: typeof fetch = fetch,
): Promise<ModelCache | null> {
  let res: Response;
  try {
    res = await fetchFn(OPENROUTER_MODELS_URL);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return null;
  }
  const models = parseInventoryPayload(payload);
  if (models.length === 0) return null;
  const cache: ModelCache = { updatedAt: new Date().toISOString(), models };
  await store.put(MODELS_CACHE_KEY, JSON.stringify(cache), { expirationTtl: MODELS_CACHE_TTL_SEC });
  return cache;
}

/** Treat broken cache as absent (fallback to bundle). */
export async function readModelCache(store: ModelStore): Promise<ModelCache | null> {
  let raw: string | null;
  try {
    raw = await store.get(MODELS_CACHE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ModelCache>;
    if (typeof parsed.updatedAt !== "string" || !Array.isArray(parsed.models)) return null;
    const models = parsed.models.filter(
      (m): m is CachedInventoryModel =>
        typeof m === "object" &&
        m !== null &&
        typeof (m as { id?: unknown }).id === "string" &&
        (m as { id: string }).id !== "",
    );
    return { updatedAt: parsed.updatedAt, models };
  } catch {
    return null;
  }
}

/** Manual purge: deletes the inventory cache only. The allowlist always reads live, so the next GET reflects it. */
export async function purgeModelCache(store: ModelStore): Promise<void> {
  await store.del(MODELS_CACHE_KEY);
}

/** Allowlist is an id-array JSON. Empty/broken/missing is null (= bundle). Dedupes. */
export function parseAllowlist(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const ids = [...new Set(parsed.filter((v): v is string => typeof v === "string" && v !== ""))];
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

export interface ResolvedModels {
  models: ResolvedModel[];
  source: "bundle" | "allowlist";
  updatedAt?: string;
}

function reasoningMetaOf(c: CachedInventoryModel): Pick<AskModel, "supportedEfforts" | "defaultEffort" | "reasoningMandatory" | "supportsImages"> {
  const supported = Array.isArray(c.supportedEfforts) ? c.supportedEfforts.filter(isEffortValue) : [];
  const def = isEffortValue(c.defaultEffort) && supported.includes(c.defaultEffort) ? c.defaultEffort : null;
  return { supportedEfforts: supported, defaultEffort: def, reasoningMandatory: c.reasoningMandatory === true, supportsImages: c.supportsImages !== false };
}

function bundleResolved(): ResolvedModel[] {
  return sortCheapFirst(BUNDLE_MODELS).map((m) => ({ ...m, selectable: true }));
}


/**
 * Resolve the model list. A KV allowlist wins when present (re-sorted cheapest
 * first); otherwise the fixed 5-model bundle (self-host runs without HOST).
 * Unknown allowlist ids are kept at the end (one-line edits reflect via purge).
 * #66: cache reasoning meta prefers newer inventory over the bundle lineup, and also covers unknown allowlist ids.
 */
export async function resolveModels(store?: ModelStore): Promise<ResolvedModels> {
  if (!store) return { models: bundleResolved(), source: "bundle" };
  let allowIds: string[] | null = null;
  try {
    allowIds = parseAllowlist(await store.get(ALLOWLIST_KEY));
  } catch {
    allowIds = null;
  }
  if (!allowIds) return { models: bundleResolved(), source: "bundle" };
  const byId = new Map<string, AskModel>();
  for (const m of BUNDLE_MODELS) byId.set(m.id, m);
  const cache = await readModelCache(store);
  const cacheById = new Map<string, CachedInventoryModel>();
  if (cache) {
    for (const c of cache.models) cacheById.set(c.id, c);
    for (const c of cache.models) {
      if (!byId.has(c.id)) {
        byId.set(c.id, {
          id: c.id,
          name: c.name,
          priceUsdPer1M: c.priceUsdPer1M,
          smartScore: 0,
          ...reasoningMetaOf(c),
        });
      }
    }
  }
  const models: ResolvedModel[] = allowIds.map((id) => {
    const meta = byId.get(id);
    const cached = cacheById.get(id);
    // #44: old-format inventory cache "lacks" reasoning meta. That is not "empty".
    // Overwriting as empty would hide the deployed bundle lineup for up to 24h.
    // Then "no effort choices" would look like a broken commit.
    // Cache with reasoning meta wins. Existing cache-first behavior is unchanged.
    if (meta && cached) {
      const imageMeta = cached.supportsImages === undefined ? {} : { supportsImages: cached.supportsImages };
      const cachedMeta = Array.isArray(cached.supportedEfforts) ? reasoningMetaOf(cached) : imageMeta;
      return { ...meta, ...(cachedMeta ?? {}), ...imageMeta, selectable: true };
    }
    if (meta) return { ...meta, selectable: true };
    return {
      id,
      name: id,
      priceUsdPer1M: Number.POSITIVE_INFINITY,
      smartScore: 0,
      supportedEfforts: [],
      defaultEffort: null,
      reasoningMandatory: false,
      supportsImages: false,
      selectable: true,
    };
  });
  const resolved: ResolvedModels = { models: sortCheapFirst(models), source: "allowlist" };
  if (cache) resolved.updatedAt = cache.updatedAt;
  return resolved;
}
