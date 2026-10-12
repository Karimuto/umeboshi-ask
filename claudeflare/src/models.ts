// S8: モデル選択の正本はHOSTのKV Allowlist、OpenRouter在庫はcron dailyキャッシュ。
// OSS境界 (ADR 0002): ここに置く価格は公開USD単価の目安のみ。credits算出式・
// マージン・残高判定はHOST金庫 (S10)。selectable/creditsはHOST overlayが付与し、
// 欠損時は選択可として扱う。自力デプロイはbundle固定5モデルで動作する。
/** #66 Effort（OpenRouter reasoning.effort）の選択値。取り揃えはモデルごとに違う。 */
export const EFFORT_VALUES = ["max", "xhigh", "high", "medium", "low", "minimal", "none"] as const;
export type EffortValue = (typeof EFFORT_VALUES)[number];
const EFFORT_KNOWN: Record<string, true> = { max: true, xhigh: true, high: true, medium: true, low: true, minimal: true, none: true };
export function isEffortValue(v: unknown): v is EffortValue {
  return typeof v === "string" && EFFORT_KNOWN[v] === true;
}
/** OpenRouter reasoning.supported_efforts を正規化する。未知値は捨て、空ならnull（選択なし扱い）。順序は受信順を保つ。 */
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
  /** 公開単価の目安 ($/1M tokens, prompt)。安い順ソート用。不明はInfinity。 */
  priceUsdPer1M: number;
  /** 予約額 (credits/問)。BUNDLE は 2026-10-06 の OpenRouter 実測を正とする。在庫由来の未知idは欠損で見積りに落ちる。 */
  credits?: number;
  /** AA-Omniscience Index (-100〜100の目安、整数丸め)。0は未取得扱いで非表示。根拠リンクは持たない (#72 Q6・Q9)。 */
  smartScore: number;
  /** #198 頭よさそうスコアの Effort 別値（AA-Omniscience Index の整数丸め）。
   *  選べる Effort のうち計測できた分だけ載せる。欠損の Effort は出さない（パネルは `—` を出す）。 */
  scores?: Partial<Record<EffortValue, number>>;
  /** #66 選べる取り揃え。空・欠損は選択なし（effort UIを出さず何も送らない）。 */
  supportedEfforts: readonly EffortValue[];
  /** #66 未指定時に送る既定。欠損時は後述の代替（medium→先頭）。 */
  defaultEffort: EffortValue | null;
  /** #66 trueならnoneを選ばせない（OpenRouter mandatory）。 */
  reasoningMandatory: boolean;
}

export interface ResolvedModel extends AskModel {
  /** 残高不足でfalse (HOST/S10が付与)。欠損・true=選択可。 */
  selectable: boolean;
  /** 予約額 (credits/問)。BUNDLE は実測値を持ち、欠損時は見積りに落ちる。 */
  credits?: number;
}
/** #66 未指定時に送る値。defaultEffortが有効ならそれ、無ければmedium、無ければ先頭。選択なしモデルはnull。 */
export function defaultEffortFor(model: Pick<AskModel, "supportedEfforts" | "defaultEffort">): EffortValue | null {
  const supported = model.supportedEfforts ?? [];
  if (supported.length === 0) return null;
  if (model.defaultEffort && (supported as readonly string[]).includes(model.defaultEffort)) return model.defaultEffort;
  if ((supported as readonly string[]).includes("medium")) return "medium";
  return supported[0] ?? null;
}
/** #66 指定値がそのモデルで有効か。mandatoryモデルはnone不可。選択なしモデルは全て不可。 */
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

/** 自力デプロイ用bundle固定5モデル（ADR 0015）。
 * 定義順＝安い順。OpenRouter単線で動く。
 * 単価は公開USD単価の目安（prompt $/1M。2026-09-23実測）。
 * 予約額 (credits/問) は2026-10-06のOpenRouter実測 cost を `ceil(cost×1200)` した値
 * （MiMo-V2.5 $0.000231→1 / GLM $0.000144→1 / MiMo-Pro $0.000653→1 /
 * Gemini $0.00452→6 / Opus $0.0254→31。入力 617〜1018 tokens）。
 * 旧式の 4000 トークン仮定は入力を 4〜6 倍に盛っていたため置き換えた。
 * 無料枠（週20・初週30）の額面は変えない。Opus (31) は無料枠で送れない。
 * smartScoreはAA-Omniscience Indexの整数丸め（2026-09-28実測。各モデルthinking level最大行）。
 * Opus 46 (max 46.42/xhigh 42.65/high 40.63/medium 40.32/low 38.87)、
 * mimo-v2.6-pro 8 (8.38)、glm-5.3-flash 7 (7.47。無印GLM-5.3 max 14.3は別物のため不採用)、
 * gemini-3.8-flash 30 (high 29.55/medium 28.58/low 21.35。max行なし)、
 * mimo-v2.5 -10 (-9.83。mimo-v2-5-pro 3.25は別物のため不採用)。
 * #198 scores は同実測の Effort 別値（整数丸め）。欠測の Effort は載せずパネルが `—` を出す。
 * Opus max 46 / xhigh 43 / high 41 / medium 40 / low 39、
 * gemini-3.8-flash high 30 / medium 29 / low 21（max 行なし）、
 * glm-5.3-flash は max 7 だけ（同モデルの high/low は実測が無いため載せない）、
 * mimo-v2.6-pro は Effort 自体を選べないので scores を持たない。
 * 実使用量の精算は#166に委ねる。本bundleの credits が予約額の正である。
 * 書き換えは再デプロイ不要: KV ask:models:allowlist:v1 にid配列JSONをputすれば即時反映される
 * （npx wrangler kv:key put --binding=UMEBOSHI_KV "ask:models:allowlist:v1" '["xiaomi/mimo-v2.5",...]'）。 */
export const BUNDLE_MODELS: readonly AskModel[] = [
  { id: "xiaomi/mimo-v2.5", name: "Xiaomi: MiMo-V2.5", priceUsdPer1M: 0.14, credits: 1, smartScore: -10, supportedEfforts: [], defaultEffort: null, reasoningMandatory: false },
  { id: "z-ai/glm-5.3-flash", name: "Z.ai: GLM 5.3 Flash", priceUsdPer1M: 0.15, credits: 1, smartScore: 7, scores: { max: 7 }, supportedEfforts: ["max", "high", "low"], defaultEffort: "max", reasoningMandatory: true },
  { id: "xiaomi/mimo-v2.6-pro", name: "Xiaomi: MiMo-V2.6-Pro", priceUsdPer1M: 0.435, credits: 1, smartScore: 8, supportedEfforts: [], defaultEffort: null, reasoningMandatory: false },
  { id: "google/gemini-3.8-flash", name: "Google: Gemini 3.8 Flash", priceUsdPer1M: 0.75, credits: 6, smartScore: 30, scores: { high: 30, medium: 29, low: 21 }, supportedEfforts: ["high", "medium", "low"], defaultEffort: "medium", reasoningMandatory: true },
  { id: "anthropic/claude-opus-5.5", name: "Anthropic: Claude Opus 5.5", priceUsdPer1M: 4.0, credits: 31, smartScore: 46, scores: { max: 46, xhigh: 43, high: 41, medium: 40, low: 39 }, supportedEfforts: ["max", "xhigh", "high", "medium", "low"], defaultEffort: "high", reasoningMandatory: true },
] as const;

/** #198 4段階（ModelTier）の組。級名は site/ のモデル区分と同じ語（ベーシック/ミドル/プレミアム）＋最上段のウルトラ。
 *  各段は (modelId, effort) の1組。effort は選択なしモデルでは null。 */
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

/** テスト・KV未束縛dev用。TTLは再現しない (purge/readの振る舞いのみ)。 */
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

/** 安い順。価格不明は末尾。安定ソートなので同額は入力順を保つ。 */
export function sortCheapFirst<T extends { priceUsdPer1M: number }>(models: readonly T[]): T[] {
  return [...models].sort((a, b) => {
    const pa = Number.isFinite(a.priceUsdPer1M) ? a.priceUsdPer1M : Number.POSITIVE_INFINITY;
    const pb = Number.isFinite(b.priceUsdPer1M) ? b.priceUsdPer1M : Number.POSITIVE_INFINITY;
    return pa - pb;
  });
}

/**
 * 残高不足モデルの選択不可を付与する純粋関数 (S10が残高と繋ぐ)。
 * balance不明 (null) またはcredits不明のモデルは選択可のまま。
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

/** 安い順で最初の選択可モデル。無ければnull。 */
export function cheapestSelectable(models: readonly ResolvedModel[]): ResolvedModel | null {
  for (const m of sortCheapFirst(models)) {
    if (m.selectable !== false) return m;
  }
  return null;
}

/**
 * S9: 現在モデル以外の安い順で最初の選択可モデル。無ければnull。
 * 15秒完全無音の単発切替先。選択不可 (selectable:false) は飛ばす。
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
  /** #66 取り揃え。欠損・空は選択なし扱い。旧cache（無印）は欠損として読む。 */
  supportedEfforts?: EffortValue[];
  /** #66 未指定時に送る既定。無効値は送らず代替に落とす。 */
  defaultEffort?: EffortValue | null;
  /** #66 trueならnoneを選ばせない。欠損はfalse扱い。 */
  reasoningMandatory?: boolean;
}

export interface ModelCache {
  updatedAt: string;
  models: CachedInventoryModel[];
}

/** #66 OpenRouter reasoning オブジェクトから取り揃え・既定・必須を抜く。壊れは空（選択なし扱い）。 */
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

/** OpenRouter GET /models のdata配列だけ抜く。壊れた要素は捨てる。 */
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
    out.push({ id: entry.id, name, priceUsdPer1M: entryPrice(entry), ...reasoning });
  }
  return out;
}

/**
 * OpenRouter在庫をKVに24h TTLで保存する (cron daily＋purge後の遅延再取得用)。
 * 取得失敗時はnullを返し、既存のstaleキャッシュを温存する。
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

/** 壊れたキャッシュは無かったことにする (bundleにfallback)。 */
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

/** 手動purge: 在庫キャッシュ削除のみ。Allowlist自体は常時live読みなので次回GETに即時反映される。 */
export async function purgeModelCache(store: ModelStore): Promise<void> {
  await store.del(MODELS_CACHE_KEY);
}

/** Allowlistはid配列JSON。空・壊れ・欠損はnull (=bundle扱い)。重複は除く。 */
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

function reasoningMetaOf(c: CachedInventoryModel): Pick<AskModel, "supportedEfforts" | "defaultEffort" | "reasoningMandatory"> {
  const supported = Array.isArray(c.supportedEfforts) ? c.supportedEfforts.filter(isEffortValue) : [];
  const def = isEffortValue(c.defaultEffort) && supported.includes(c.defaultEffort) ? c.defaultEffort : null;
  return { supportedEfforts: supported, defaultEffort: def, reasoningMandatory: c.reasoningMandatory === true };
}

function bundleResolved(): ResolvedModel[] {
  return sortCheapFirst(BUNDLE_MODELS).map((m) => ({ ...m, selectable: true }));
}


/**
 * モデル一覧を解決する。KV Allowlistがあれば正とし (安い順に並べ直す)、
 * 無ければbundle固定5モデル (自力デプロイはHOSTなしで動作)。
 * Allowlist未知idも落とさず末尾に含める (1行変更がpurgeで即時反映される)。
 * #66: cacheのreasoningメタはbundle品揃えより新しい在庫を優先し、Allowlist未知idにも載せる。
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
    // #44: 旧形式の在庫cacheは reasoning メタを「持っていない」。それは「空」ではない。
    // 空として上書きすると、deploy 済みの bundle の取り揃えを最大24h隠す。
    // そうすると「Effort の選択肢が出ない = commit がつぶれた」ように見える。
    // reasoning メタを持つ cache が正。cache 優先という既存動作は変えない。
    if (meta && cached) {
      const cachedMeta = Array.isArray(cached.supportedEfforts) ? reasoningMetaOf(cached) : null;
      return { ...meta, ...(cachedMeta ?? {}), selectable: true };
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
      selectable: true,
    };
  });
  const resolved: ResolvedModels = { models: sortCheapFirst(models), source: "allowlist" };
  if (cache) resolved.updatedAt = cache.updatedAt;
  return resolved;
}
