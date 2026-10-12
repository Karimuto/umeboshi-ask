// #260 OS3b: モデル一覧の bundle 側（一覧 route・価格順・Effort の解像）はコア入口
// (src/core.ts) を向く。Allowlist・在庫cache・cron・purge・credits の残高は hosted
// の機構なので test/full/models-allowlist.test.ts が完全版入口を向いて検証する。
import { describe, expect, it } from "vitest";
import { handleCoreRequest } from "../../src/core";
import {
  BUNDLE_MODELS,
  MODEL_PRESETS,
  cheapestSelectable,
  defaultEffortFor,
  isValidEffortForModel,
  nextFallbackModel,
  parseReasoningMeta,
  parseSupportedEfforts,
  sortCheapFirst,
} from "../../src/models";

const env = {};

function get(path: string, init?: RequestInit): Request {
  return new Request(`https://ask.example${path}`, init);
}

describe("GET /api/ask/models (S1足場＋S8)", () => {
  it("KVなし自力デプロイはbundle固定5件を安い順で返す", async () => {
    const res = await handleCoreRequest(get("/api/ask/models"), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      models: {
        id: string;
        name: string;
        priceUsdPer1M: number;
        smartScore: number;
        selectable: boolean;
        supportedEfforts: string[];
        defaultEffort: string | null;
        reasoningMandatory: boolean;
      }[];
      source: string;
    };
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models.length).toBe(5);
    expect(body.source).toBe("bundle");
    const prices = body.models.map((m) => m.priceUsdPer1M);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    for (const m of body.models) {
      expect(m.id.length).toBeGreaterThan(0);
      expect(m.name.length).toBeGreaterThan(0);
      expect(typeof m.priceUsdPer1M).toBe("number");
      expect(typeof m.smartScore).toBe("number");
      expect(m.selectable).toBe(true);
      expect(Array.isArray(m.supportedEfforts)).toBe(true);
      expect(typeof m.reasoningMandatory).toBe("boolean");
    }
  });

  it("bundleのid/nameは固定5モデルと一致する", async () => {
    const res = await handleCoreRequest(get("/api/ask/models"), env);
    const body = (await res.json()) as { models: { id: string; name: string }[] };
    expect(body.models.map((m) => ({ id: m.id, name: m.name }))).toEqual(
      [...BUNDLE_MODELS]
        .sort((a, b) => a.priceUsdPer1M - b.priceUsdPer1M)
        .map((m) => ({ id: m.id, name: m.name })),
    );
  });

  it("idが重複しない", async () => {
    const res = await handleCoreRequest(get("/api/ask/models"), env);
    const body = (await res.json()) as { models: { id: string }[] };
    expect(new Set(body.models.map((m) => m.id)).size).toBe(5);
  });

  it("bundleはOpenRouter形5モデルと一致する", async () => {
    const res = await handleCoreRequest(get("/api/ask/models"), env);
    const body = (await res.json()) as { models: { id: string }[] };
    expect(body.models.map((m) => m.id).sort()).toEqual(
      [
        "xiaomi/mimo-v2.5",
        "xiaomi/mimo-v2.6-pro",
        "z-ai/glm-5.3-flash",
        "google/gemini-3.8-flash",
        "anthropic/claude-opus-5.5",
      ].sort(),
    );
  });

  // #100 穴1: 以前は `origin ?? "*"` で無条件に反転返していた。
  // 任意オリジンのJSONがブラウザ経由で読めていたことを塞ぐ。
  it("許可リストのOriginだけをechoし、他はACAOを出さない", async () => {
    // Ankiのfile:// WebView（Origin: null）は許可。
    const anki = await handleCoreRequest(
      get("/api/ask/models", { headers: { Origin: "null" } }),
      env,
    );
    expect(anki.headers.get("Access-Control-Allow-Origin")).toBe("null");

    // 同一origin（Worker自身の/billingから）は許可。
    const same = await handleCoreRequest(
      get("/api/ask/models", { headers: { Origin: "https://ask.example" } }),
      env,
    );
    expect(same.headers.get("Access-Control-Allow-Origin")).toBe("https://ask.example");

    // 別オリジンはACAO無し。ブラウザが読めなくなるのが防御。
    const evil = await handleCoreRequest(
      get("/api/ask/models", { headers: { Origin: "https://evil.example" } }),
      env,
    );
    expect(evil.headers.get("Access-Control-Allow-Origin")).toBeNull();

    // Originヘッダ無し（curl / AnkiConnect / Stripe webhook）。
    const missing = await handleCoreRequest(get("/api/ask/models"), env);
    expect(missing.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("OPTIONS preflightに204で応答する", async () => {
    const res = await handleCoreRequest(
      get("/api/ask/models", { method: "OPTIONS", headers: { Origin: "null" } }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("null");
  });

  it("未知パスは404 JSON", async () => {
    const res = await handleCoreRequest(get("/api/ask/nope"), env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not Found" });
  });
});

describe("#72 AA-Omniscienceスコア", () => {
  it("bundle 5件はOmniscience整数丸めと一致する", () => {
    expect(BUNDLE_MODELS.map((m) => [m.id, m.smartScore])).toEqual([
      ["xiaomi/mimo-v2.5", -10],
      ["z-ai/glm-5.3-flash", 7],
      ["xiaomi/mimo-v2.6-pro", 8],
      ["google/gemini-3.8-flash", 30],
      ["anthropic/claude-opus-5.5", 46],
    ]);
  });

  it("bundle解決はevidenceUrlを持たない", async () => {
    const res = await handleCoreRequest(get("/api/ask/models"), env);
    const body = (await res.json()) as { models: Record<string, unknown>[] };
    for (const m of body.models) expect("evidenceUrl" in m).toBe(false);
  });

  // #198: 頭よさそうスコアを Effort 別に出すための値。実測した Effort だけを載せ、
  // 欠測（glm-5.3-flash の high/low）は載せない。パネル側は欠損を `—` にする。
  it("bundleのscoresはEffort別の実測値だけを持つ", () => {
    const scoresById = Object.fromEntries(BUNDLE_MODELS.map((m) => [m.id, m.scores]));
    expect(scoresById["anthropic/claude-opus-5.5"]).toEqual({ max: 46, xhigh: 43, high: 41, medium: 40, low: 39 });
    expect(scoresById["google/gemini-3.8-flash"]).toEqual({ high: 30, medium: 29, low: 21 });
    expect(scoresById["z-ai/glm-5.3-flash"]).toEqual({ max: 7 });
    // Effort を選べないモデルは scores を持たない。
    expect(scoresById["xiaomi/mimo-v2.6-pro"]).toBeUndefined();
    expect(scoresById["xiaomi/mimo-v2.5"]).toBeUndefined();
  });

  it("scoresのキーはどのモデルもsupportedEffortsに収まる", () => {
    for (const m of BUNDLE_MODELS) {
      for (const effort of Object.keys(m.scores ?? {})) {
        expect((m.supportedEfforts as readonly string[]).includes(effort)).toBe(true);
      }
    }
  });

  // #198: 4段階プリセット。credits（予約額）を出さずに頭よさそうスコアで選ばせる。
  it("MODEL_PRESETSは4段階を順に持ち、bundleのidと矛盾しない", () => {
    expect(MODEL_PRESETS.map((p) => p.tier)).toEqual(["basic", "middle", "premium", "ultra"]);
    for (const p of MODEL_PRESETS) {
      const model = BUNDLE_MODELS.find((m) => m.id === p.modelId);
      expect(model).toBeDefined();
      if (p.effort === null) {
        expect(model!.supportedEfforts).toEqual([]);
      } else {
        expect((model!.supportedEfforts as readonly string[]).includes(p.effort)).toBe(true);
      }
    }
  });

  it("GET /api/ask/modelsはpresetsを返す", async () => {
    const res = await handleCoreRequest(get("/api/ask/models"), env);
    const body = (await res.json()) as { presets: unknown };
    expect(body.presets).toEqual(MODEL_PRESETS);
  });
});

describe("S8 選択可否の純粋関数 (S10が残高と繋ぐ)", () => {
  it("cheapestSelectableは安い順で最初の選択可を返す", () => {
    const models = [
      { id: "a", name: "a", priceUsdPer1M: 3, smartScore: 0, supportedEfforts: [], defaultEffort: null, reasoningMandatory: false, selectable: false },
      { id: "b", name: "b", priceUsdPer1M: 1, smartScore: 0, supportedEfforts: [], defaultEffort: null, reasoningMandatory: false, selectable: true },
      { id: "c", name: "c", priceUsdPer1M: 0.1, smartScore: 0, supportedEfforts: [], defaultEffort: null, reasoningMandatory: false, selectable: false },
    ];
    expect(cheapestSelectable(models)?.id).toBe("b");
    expect(cheapestSelectable([])).toBeNull();
  });

  it("nextFallbackModelは現行以外の安い選択可を返す・無ければnull", () => {
    const models = [
      { id: "cheap", name: "cheap", priceUsdPer1M: 0.1, smartScore: 0, supportedEfforts: [], defaultEffort: null, reasoningMandatory: false, selectable: true },
      { id: "mid", name: "mid", priceUsdPer1M: 0.5, smartScore: 0, supportedEfforts: [], defaultEffort: null, reasoningMandatory: false, selectable: false },
      { id: "high", name: "high", priceUsdPer1M: 1, smartScore: 0, supportedEfforts: [], defaultEffort: null, reasoningMandatory: false, selectable: true },
    ];
    expect(nextFallbackModel(models, "cheap")?.id).toBe("high");
    expect(nextFallbackModel(models, "high")?.id).toBe("cheap");
    expect(nextFallbackModel(models, "other")?.id).toBe("cheap");
    expect(nextFallbackModel([models[0]!], "cheap")).toBeNull();
    expect(nextFallbackModel([], "cheap")).toBeNull();
  });

  it("sortCheapFirstは価格不明を末尾にし安定に並べる", () => {
    const out = sortCheapFirst([
      { priceUsdPer1M: Number.POSITIVE_INFINITY },
      { priceUsdPer1M: 2 },
      { priceUsdPer1M: 1 },
    ]);
    expect(out.map((m) => m.priceUsdPer1M)).toEqual([1, 2, Number.POSITIVE_INFINITY]);
  });
});

describe("#66 Effort取り揃え", () => {
  it("parseSupportedEffortsは未知値・重複を捨て、空ならnull", () => {
    expect(parseSupportedEfforts(["high", "low", "high", "ultra"])).toEqual(["high", "low"]);
    expect(parseSupportedEfforts([])).toBeNull();
    expect(parseSupportedEfforts(["ultra"])).toBeNull();
    expect(parseSupportedEfforts(null)).toBeNull();
  });

  it("parseReasoningMetaはsupportedなしを空にし、範囲外defaultを落とす", () => {
    expect(parseReasoningMeta(null)).toEqual({ supportedEfforts: [], defaultEffort: null, reasoningMandatory: false });
    expect(parseReasoningMeta({ mandatory: true })).toEqual({
      supportedEfforts: [],
      defaultEffort: null,
      reasoningMandatory: false,
    });
    expect(
      parseReasoningMeta({ supported_efforts: ["max", "high"], default_effort: "low", mandatory: true }),
    ).toEqual({ supportedEfforts: ["max", "high"], defaultEffort: null, reasoningMandatory: true });
    expect(
      parseReasoningMeta({ supported_efforts: ["max", "high"], default_effort: "high", mandatory: true }),
    ).toEqual({ supportedEfforts: ["max", "high"], defaultEffort: "high", reasoningMandatory: true });
  });

  it("bundleの取り揃えは2026-09-28実測と一致する", () => {
    const byId = new Map(BUNDLE_MODELS.map((m) => [m.id, m]));
    expect(byId.get("xiaomi/mimo-v2.5")?.supportedEfforts).toEqual([]);
    expect(byId.get("z-ai/glm-5.3-flash")).toMatchObject({ supportedEfforts: ["max", "high", "low"], defaultEffort: "max" });
    expect(byId.get("google/gemini-3.8-flash")).toMatchObject({
      supportedEfforts: ["high", "medium", "low"],
      defaultEffort: "medium",
    });
    expect(byId.get("anthropic/claude-opus-5.5")).toMatchObject({
      supportedEfforts: ["max", "xhigh", "high", "medium", "low"],
      defaultEffort: "high",
    });
  });
  it("defaultEffortForは未指定時にdefault→medium→先頭の順で送る値を返す", () => {
    expect(defaultEffortFor(BUNDLE_MODELS.find((m) => m.id === "z-ai/glm-5.3-flash")!)).toBe("max");
    expect(
      defaultEffortFor({ supportedEfforts: ["high", "low"], defaultEffort: null }),
    ).toBe("high");
    expect(
      defaultEffortFor({ supportedEfforts: ["high", "medium", "low"], defaultEffort: "ultra" as never }),
    ).toBe("medium");
    expect(defaultEffortFor({ supportedEfforts: [], defaultEffort: null })).toBeNull();
  });

  it("isValidEffortForModelはmandatoryのnoneと範囲外を拒否する", async () => {
    const opus = BUNDLE_MODELS.find((m) => m.id === "anthropic/claude-opus-5.5")!;
    expect(isValidEffortForModel(opus, "high")).toBe(true);
    expect(isValidEffortForModel(opus, "none")).toBe(false);
    expect(isValidEffortForModel(opus, "minimal")).toBe(false);
    const mimo = BUNDLE_MODELS.find((m) => m.id === "xiaomi/mimo-v2.5")!;
    expect(isValidEffortForModel(mimo, "low")).toBe(false);
  });
});
