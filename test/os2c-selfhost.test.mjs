import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { panelScript } from "./lib/panel-script.mjs";

// OS2c (#258): URL/token を貼るだけで自分の Worker に繋がる end-to-end の vm ゲート。
// s13-dod は他チケットが編集中なので衝突を避け、このファイルに OS2c の契約を
// 独立に固定する。vm ハーネスは s13-dod の drive() から最小限を写したもの。
//
// 契約（#258 で定義）:
//   接続先 = 設定の Worker URL > root.UMEBOSHI_ASK_API_BASE（外部フック）> 既定の公式 URL
//   Authorization = 設定のアクセストークン > ログインのアクセストークン
//   誤 token の 401 は面板のエラー領域へ workerTokenInvalid の案内を出す
//
// 実 Worker（wrangler dev・ローカル KV）との round-trip は
// docs/runbook-os2c-selfhost.md の手順で別途確認する（ここでは vm で固定）。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const BUILT = path.join(REPO, "addon/templates/inject.html");
const SRC = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
// コメントを外した本文。「コードに現れない」を数えるときはこちらを読む。
const SRC_CODE = (p) =>
  SRC(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// 面板の3コピー。雛形（scaffold＋partial）・base ビルド出力（AnkiWeb add-on が
// 積む inject.html）・注入版（host build＝base＋billing module）。AC の
// 「各コピーで一致した動き」を这うので3本とも vm に流せる形で持つ。
// OS5c (#265): ログイン UI は module 側へ移った。既定の drive は注入版を読む。
// assert は 1 つも変えない。
const TEMPLATE_SCRIPT = panelScript();
const BUILT_SCRIPT = panelScript({ from: BUILT });
// OSS tree には module が無い。無いときは注入版を base で代用する。
// host 側では従来どおり注入版を読む。
const HAS_MODULE = fs.existsSync(path.join(REPO, "src/commercial/panel-module.js"));
const MODULE_SCRIPT = HAS_MODULE ? panelScript({ module: true }) : BUILT_SCRIPT;
const COPIES = HAS_MODULE ? [
  ["雛形（scaffold 連結）", TEMPLATE_SCRIPT],
  ["base ビルド出力（inject.html）", BUILT_SCRIPT],
  ["注入版（base + billing module）", MODULE_SCRIPT],
] : [
  ["雛形（scaffold 連結）", TEMPLATE_SCRIPT],
  ["base ビルド出力（inject.html）", BUILT_SCRIPT],
];

const IDS = [
  "umeboshi-ask-auth-status", "umeboshi-ask-account-status", "umeboshi-ask-addon-guide",
  "umeboshi-ask-login-btn", "umeboshi-ask-logout-btn", "umeboshi-ask-redeem-row",
  "umeboshi-ask-code-input", "umeboshi-ask-redeem-btn", "umeboshi-ask-export-btn",
  "umeboshi-ask-import-btn", "umeboshi-ask-migrate-status", "umeboshi-ask-migrate-login-hint",
  "umeboshi-ask-send-btn", "umeboshi-ask-save-btn", "umeboshi-ask-cardid-banner",
  "umeboshi-ask-storage-banner",
  "umeboshi-ask-consent-modal", "umeboshi-ask-settings-modal", "umeboshi-ask-models-status",
  "umeboshi-ask-input", "umeboshi-ask-send-hint", "umeboshi-ask-settings-body",
  "umeboshi-ask-ankidroid-kb-hint",
  "umeboshi-ask-settings-tabs", "umeboshi-ask-settings-search", "umeboshi-ask-search-hint",
  "umeboshi-ask-detailbar", "umeboshi-ask-detail-back", "umeboshi-ask-detail-src",
  "umeboshi-ask-detail-title", "umeboshi-ask-results", "umeboshi-ask-consent-status",
  "umeboshi-ask-age-check", "umeboshi-ask-age-check-label", "umeboshi-ask-withdraw-note",
  "umeboshi-ask-consent-agree", "umeboshi-ask-consent-later", "umeboshi-ask-consent-withdraw",
  "umeboshi-ask-consent-title", "umeboshi-ask-consent-body",
  "umeboshi-ask-card-id", "umeboshi-ask-buttons", "umeboshi-ask-model",
  "umeboshi-ask-model-popup", "umeboshi-ask-model-backdrop", "umeboshi-ask-model-sheet",
  "umeboshi-ask-model-sheet-head", "umeboshi-ask-model-sheet-title", "umeboshi-ask-model-close",
  "umeboshi-ask-model-back", "umeboshi-ask-model-list", "umeboshi-ask-model-label",
  "umeboshi-ask-effort-popup", "umeboshi-ask-effort-backdrop", "umeboshi-ask-effort-sheet",
  "umeboshi-ask-effort-sheet-head", "umeboshi-ask-effort-sheet-title", "umeboshi-ask-effort-close",
  "umeboshi-ask-effort-back", "umeboshi-ask-effort-list", "umeboshi-ask-effort-note",
  "umeboshi-ask-tier-popup", "umeboshi-ask-tier-backdrop", "umeboshi-ask-tier-sheet",
  "umeboshi-ask-tier-sheet-head", "umeboshi-ask-tier-sheet-title", "umeboshi-ask-tier-close",
  "umeboshi-ask-tier-list", "umeboshi-ask-tier-foot", "umeboshi-ask-tier-detail-btn",
  "umeboshi-ask-credit-status", "umeboshi-ask-credit-refresh", "umeboshi-ask-credit-notice",
  "umeboshi-ask-billing-btn", "umeboshi-ask-billing-login-hint", "umeboshi-ask-billing-status",
  "umeboshi-ask-settings-btn", "umeboshi-ask-settings-close", "umeboshi-ask-prompt-list",
  "umeboshi-ask-custom-list", "umeboshi-ask-current", "umeboshi-ask-thinking",
  "umeboshi-ask-thinking-body", "umeboshi-ask-answer", "umeboshi-ask-stream-status",
  "umeboshi-ask-stream-q", "umeboshi-ask-thread", "umeboshi-ask-thread-list",
  "umeboshi-ask-thread-status", "umeboshi-ask-messages", "umeboshi-ask-input-row",
  "umeboshi-ask-drawer", "umeboshi-ask-search-clear", "umeboshi-ask-lang-status",
  "umeboshi-ask-reset-all", "umeboshi-ask-reset-prompts",
  "umeboshi-ask-title-sendmode", "umeboshi-ask-title-consent", "umeboshi-ask-title-reset",
  "umeboshi-ask-title-lang", "umeboshi-ask-title-account", "umeboshi-ask-title-migrate",
  "umeboshi-ask-title-credit", "umeboshi-ask-title-billing",
  "umeboshi-ask-title-workerurl", "umeboshi-ask-title-workertoken",
  "umeboshi-ask-worker-url", "umeboshi-ask-worker-url-note",
  "umeboshi-ask-worker-token", "umeboshi-ask-worker-token-note",
  "umeboshi-ask-sendmode-button", "umeboshi-ask-sendmode-enter",
  "umeboshi-ask-lang-radio-auto", "umeboshi-ask-lang-radio-ja", "umeboshi-ask-lang-radio-en",
  "umeboshi-ask-consent-state", "umeboshi-ask-account-state",
  "umeboshi-ask-prompts-note", "umeboshi-ask-billing-note",
  "raw-text", "text", "extra",
];

class FakeEl {
  constructor(id = "") {
    this.id = id;
    this.hidden = false;
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this.checked = false;
    this.title = "";
    this.type = "";
    this.children = [];
    this.parentNode = null;
    this._ls = {};
    this.style = {};
    this.className = "";
    this.dataset = {};
    this.selectedIndex = -1;
  }
  get firstChild() { return this.children[0] || null; }
  addEventListener(t, fn) { (this._ls[t] = this._ls[t] || []).push(fn); }
  removeEventListener() {}
  click() { for (const fn of this._ls["click"] || []) fn.call(this, { target: this }); }
  appendChild(c) { if (c) { this.children.push(c); c.parentNode = this; } return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  setAttribute(k, v) { this["attr_" + k] = String(v); if (k === "disabled") this.disabled = true; }
  getAttribute(k) { return this["attr_" + k] ?? null; }
  removeAttribute(k) { delete this["attr_" + k]; if (k === "disabled") this.disabled = false; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  scrollIntoView() {}
  get classList() {
    return { add: () => {}, remove: () => {}, contains: () => false };
  }
}

function textOf(el) {
  if (!el) return "";
  if (el.nodeType === 3) return el.textContent || "";
  let s = el.textContent || "";
  for (const c of el.children || []) s += textOf(c);
  return s;
}

function makeMemory(init = {}) {
  const data = { ...init };
  return {
    getItem(k) { return k in data ? data[k] : null; },
    setItem(k, v) { data[k] = String(v); },
    removeItem(k) { delete data[k]; },
  };
}

function resp(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
const sseLine = (obj) => "data: " + JSON.stringify(obj);
function sseResp(lines) {
  return { ok: true, status: 200, text: async () => lines.join("\n"), json: async () => ({}) };
}

const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

async function drive(opts = {}) {
  const {
    cardId = "1234567890123",
    consent = false,
    rawText = "",
    onFetch = null,
    localInit = {},
    script = MODULE_SCRIPT,
  } = opts;
  const els = {};
  for (const id of IDS) els[id] = new FakeEl(id);
  els["umeboshi-ask-login-btn"].hidden = false;
  els["umeboshi-ask-logout-btn"].hidden = true;
  els["umeboshi-ask-redeem-row"].hidden = false;
  els["umeboshi-ask-card-id"].textContent = cardId;
  els["umeboshi-ask-consent-modal"].hidden = true;
  els["umeboshi-ask-settings-modal"].hidden = true;
  els["umeboshi-ask-model-popup"].hidden = true;
  els["umeboshi-ask-effort-popup"].hidden = true;
  els["umeboshi-ask-tier-popup"].hidden = true;
  els["raw-text"].textContent = rawText;

  const local = makeMemory({ ...localInit });
  const calls = [];
  const defaultFetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/api/ask/models")) return resp(200, { models: [] });
    if (u.endsWith("/api/usage")) return resp(200, { unavailable: true });
    if (u.endsWith("/api/billing/plans")) return resp(200, { plans: [] });
    return resp(404, {});
  };
  const fetchStub = async (url, init) => {
    if (onFetch) {
      const r = await onFetch(String(url), init, calls);
      if (r) { calls.push({ url: String(url), init }); return r; }
    }
    const r = await defaultFetch(url, init);
    calls.push({ url: String(url), init });
    return r;
  };
  for (const key of ["why", "what", "significance", "origin", "eli5"]) {
    const b = new FakeEl("");
    b.setAttribute("data-ask", key);
    els["umeboshi-ask-buttons"].appendChild(b);
  }
  const doc = {
    getElementById: (id) => els[id] || null,
    createElement: () => new FakeEl(""),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    body: { className: "" },
  };
  const sandbox = {
    console, Promise, JSON, Date, Math, Object, Array, String, Number, Boolean, RegExp, Error,
    setTimeout, clearTimeout, TextDecoder, AbortController,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = doc;
  sandbox.fetch = fetchStub;
  sandbox.localStorage = local;
  sandbox.location = { port: "" };
  sandbox.navigator = { language: "ja-JP", userAgent: "" };
  sandbox.UMEBOSHI_ASK_API_BASE = "https://test.example";
  sandbox.open = () => {};
  sandbox.confirm = () => true;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: "askScaffold.js" });
  await tick();
  if (consent && !("umeboshi-ask:consent:v1" in localInit)) {
    els["umeboshi-ask-age-check"].checked = true;
    els["umeboshi-ask-consent-agree"].click();
    await tick();
  }

  return {
    sandbox, els, local, calls,
    chatCalls: () => calls.filter((c) => c.url.endsWith("/api/ask/chat")),
    chatBody: () => {
      const c = calls.filter((x) => x.url.endsWith("/api/ask/chat")).at(-1);
      return c ? JSON.parse(c.init.body) : null;
    },
    threadsPosts: () => calls.filter((c) => c.url.includes("/api/ask/threads/") && c.init?.method === "POST"),
    async agree() { els["umeboshi-ask-age-check"].checked = true; els["umeboshi-ask-consent-agree"].click(); await tick(); },
    async ask(key) {
      const box = els["umeboshi-ask-buttons"];
      const btn = box.children.find((c) => c.getAttribute("data-ask") === key);
      assert.ok(btn, "static button " + key);
      for (const fn of box._ls["click"] || []) fn.call(box, { target: btn });
      await tick(12);
    },
    async redeem(code = "ABCDEFGHIJ1234567890") {
      els["umeboshi-ask-code-input"].value = code;
      els["umeboshi-ask-redeem-btn"].click();
      await tick(12);
    },
  };
}

const URL_KEY = "umeboshi-ask:worker-url:v1";
const TOKEN_KEY = "umeboshi-ask:worker-token:v1";
const REFRESH_KEY = "umeboshi-ask:refresh:v1";
const OFFICIAL = "https://umeboshi-ask.umeboshi-ask.workers.dev";
// drive() が window に焼く外部フック。設定が空のときはここが効く。
const HOOK = "https://test.example";
// ログイン（redeem）で得るアクセストークン。既定 endpoint の既有挙動の照合に使う。
const LOGIN_TOKEN = "a1";
const chatSse = async (url) => (url.endsWith("/api/ask/chat") ? sseResp([sseLine({ type: "done" })]) : null);
const redeemOK = async (url) => (url.endsWith("/api/auth/redeem")
  ? resp(200, { accessToken: LOGIN_TOKEN, refreshToken: "r1" })
  : null);
const chatOrRedeem = async (url) => (await redeemOK(url)) ?? chatSse(url);
const enSettings = { "umeboshi-ask:settings:v1": JSON.stringify({ version: 1, sendMode: "button", lang: "en" }) };

describe("#258 OS2c URL/token で自分の Worker に繋がる", () => {
  it("接続先は呼び出しごとに「設定 > フック > 既定」の順に解決する", async () => {
    // 設定が空ならフック（従来どおり）。chat もモデル一覧も同じ解決を使う。
    const hook = await drive({ consent: true, onFetch: chatSse });
    await hook.ask("why");
    assert.equal(hook.chatCalls().at(-1).url, HOOK + "/api/ask/chat");
    assert.equal(hook.calls.some((c) => c.url === HOOK + "/api/ask/models"), true,
      "モデル一覧がフックを見ていない");

    // 設定の Worker URL はフックに勝つ。スクリプト読み込み後に保存した値でも
    // 次の送信から効く（読み込み時の snapshot にしていない証拠）。
    const set = await drive({ consent: true, onFetch: chatSse });
    set.local.setItem(URL_KEY, "https://mine.example");
    await set.ask("why");
    assert.equal(set.chatCalls().at(-1).url, "https://mine.example/api/ask/chat");

    // 保存済みの設定 URL は読み込み時の fetch（モデル一覧）にも効く。
    const models = await drive({ consent: true, localInit: { [URL_KEY]: "https://mine.example" } });
    assert.equal(models.calls.some((c) => c.url === "https://mine.example/api/ask/models"), true);

    // 設定もフックも無ければ既定の公式 URL（導線維持）。
    const def = await drive({ consent: true, onFetch: chatSse });
    delete def.sandbox.UMEBOSHI_ASK_API_BASE;
    await def.ask("why");
    assert.equal(def.chatCalls().at(-1).url, OFFICIAL + "/api/ask/chat");
  });

  it("接続先の解決は currentApiBase() の1箇所だけ（読み込み時の snapshot が無い）", () => {
    const code = SRC_CODE("src/components/askScaffold.ejs");
    // 読み込み時の apiBase snapshot 変数は持たない。
    assert.doesNotMatch(code, /\bapiBase\b/, "apiBase という名前の束が残っている");
    // 既定 URL を参照するのは宣言と currentApiBase() の中だけ。
    assert.equal([...SRC("src/components/askScaffold.ejs").matchAll(/DEFAULT_API_BASE/g)].length, 2);
    assert.match(code, /function currentApiBase\(\)[\s\S]*?return DEFAULT_API_BASE;/);
    // URL を作る base の全箇所が currentApiBase() 経由（usage は OS5a で module 側へ移った）。
    for (const p of ['"/api/ask/chat"', '"/api/ask/models"']) {
      assert.ok(code.includes("currentApiBase() + " + p), p + " が currentApiBase() 経由でない");
    }
    assert.ok(code.includes("currentApiBase() + path"), "path 組み立てが currentApiBase() 経由でない");
    // OS5c (#265): login 導線は module 側へ移った。base に login URL は無い。
    // module の login が resolver 経由であることを見る。
    // OSS tree には module が無いので、あるときだけ見る。
    // host 側では従来どおり module を見る。
    if (fs.existsSync(path.join(REPO, "src/commercial/panel-module.js"))) {
      assert.ok(SRC("src/commercial/panel-module.js").includes('currentApiBase() + "/api/auth/login?lang="'), "module の login URL が currentApiBase() 経由でない");
      // module の usage も base の resolver 経由（自己ホストの設定が課金表示だけ効かないコピーを作らない）。
      const mod = SRC_CODE("src/commercial/panel-module.js");
      assert.ok(mod.includes('currentApiBase() + "/api/usage"'), "module の usage が currentApiBase() 経由でない");
    }
    // Bearer の優先順位も1箇所に寄せる。
    assert.equal((code.match(/function bearerToken\(\)/g) || []).length, 1);
  });

  it("Bearer は設定のアクセストークンが優先。未設定ならログインのアクセストークン", async () => {
    // 設定 token は chat でも保存系（authFetch）でもログイン token より優先する。
    const set = await drive({
      consent: true,
      localInit: { [URL_KEY]: "https://mine.example", [TOKEN_KEY]: "s3cret" },
      onFetch: chatSse,
    });
    await set.ask("why");
    assert.equal(set.chatCalls().at(-1).init.headers.Authorization, "Bearer s3cret");

    // OSS tree には module（login の実体）が無いので、以下は host 側だけ。
    // host 側では従来どおりログイン token の優先順位を見る。
    // 未設定なら redeem で得たログインのアクセストークン（既定 endpoint の挙動は不変）。
    if (HAS_MODULE) {
      const login = await drive({ consent: true, onFetch: chatOrRedeem });
      await login.redeem();
      await login.ask("why");
      assert.equal(login.chatCalls().at(-1).init.headers.Authorization, "Bearer " + LOGIN_TOKEN);
    }

    // どちらも無ければ Bearer は付けない（匿名質問はそのまま動く）。
    const anon = await drive({ consent: true, onFetch: chatSse });
    await anon.ask("why");
    assert.equal(anon.chatCalls().at(-1).init.headers.Authorization, undefined);

    // OSS tree には module（usage の実体）が無いので、以下は host 側だけ。
    // host 側では従来どおり usage の優先順位を見る。
    if (!HAS_MODULE) return;

    // usage も同じ優先順位で Authorization を付ける（usage は OS5a で module 側なので注入版で流す）。
    const usage = await drive({
      consent: true,
      localInit: { [TOKEN_KEY]: "s3cret" },
      script: MODULE_SCRIPT,
      onFetch: async (url) => {
        if (url === HOOK + "/api/usage") return resp(200, { unavailable: true });
        return chatSse(url);
      },
    });
    usage.els["umeboshi-ask-settings-btn"].click();
    await tick(12);
    const usageCall = usage.calls.find((c) => c.url === HOOK + "/api/usage");
    assert.ok(usageCall, "設定を開くと usage を引きに行く");
    assert.equal(usageCall.init.headers.Authorization, "Bearer s3cret");
  });

  it("設定 token だけ（ログイン無し）で保存・再読み込みが通る（自己ホストの round-trip の前提）", async () => {
    const saved = { question: "なぜ空は青い？", answer: "レイリー散乱のため。" };
    let postUrl = "";
    let postBearer = "";
    const onFetch = async (url, init) => {
      const r = await redeemOK(url);
      if (r) return r;
      if (url.includes("/api/ask/threads/") && init?.method === "POST") {
        postUrl = url;
        postBearer = init.headers.Authorization;
        const body = JSON.parse(init.body);
        return resp(200, { message: { id: "m1", question: body.question, answer: body.answer } });
      }
      if (url.includes("/api/ask/threads/") && (!init || init.method === "GET")) {
        return resp(200, { messages: [{ id: "m1", question: saved.question, answer: saved.answer }] });
      }
      return chatSse(url);
    };
    // ログインはしない。設定のトークンだけで Bearer が乗る。
    const h = await drive({
      consent: true,
      localInit: { [URL_KEY]: "https://mine.example", [TOKEN_KEY]: "s3cret" },
      onFetch,
    });
    h.sandbox.UmeboshiAskThread.save(saved.question, saved.answer);
    await tick(12);
    assert.equal(postUrl, "https://mine.example/api/ask/threads/1234567890123/messages");
    assert.equal(postBearer, "Bearer s3cret");
    assert.equal(h.els["umeboshi-ask-thread-status"].textContent, "");
    assert.match(textOf(h.els["umeboshi-ask-thread-list"]), /レイリー散乱/);

    // 再読み込み（vm を作り直す＝idbMem も空）で threads GET が叩かれ、
    // 保存した解答が Thread に再表示される。
    const again = await drive({
      consent: true,
      localInit: { [URL_KEY]: "https://mine.example", [TOKEN_KEY]: "s3cret" },
      onFetch,
    });
    const get = again.calls.find((c) => c.url.includes("/api/ask/threads/") && (!c.init || c.init.method === "GET"));
    assert.ok(get, "panel 読み込みで threads GET が走る");
    assert.equal(get.init?.headers?.Authorization, "Bearer s3cret");
    await tick(12);
    assert.equal(again.sandbox.UmeboshiAskThread.getMessages().length, 1);
    assert.match(textOf(again.els["umeboshi-ask-thread-list"]), /レイリー散乱/);
  });

  it("誤 token の 401 は「設定のアクセストークンを確認して」の案内を出す（ja/en）", async () => {
    const wrong = async (url) => (url.endsWith("/api/ask/chat") ? resp(401, { needLogin: true }) : null);
    const ja = await drive({ consent: true, localInit: { [TOKEN_KEY]: "wrong" }, onFetch: wrong });
    await ja.ask("why");
    assert.match(ja.els["umeboshi-ask-stream-status"].textContent, /設定のアクセストークンを確認してください/);
    // 既定 endpoint の汎用失敗文ではない理由として出す。
    assert.doesNotMatch(ja.els["umeboshi-ask-stream-status"].textContent, /送信できませんでした/);

    const en = await drive({
      consent: true,
      localInit: { ...enSettings, [TOKEN_KEY]: "wrong" },
      onFetch: wrong,
    });
    await en.ask("why");
    assert.match(en.els["umeboshi-ask-stream-status"].textContent, /Check the access token in settings/);
    assert.doesNotMatch(en.els["umeboshi-ask-stream-status"].textContent, /Could not send/);
  });

  it("設定 token が無い 401 は既定の汎用失敗文のまま（既定 endpoint の挙動は不変）", async () => {
    const h = await drive({ consent: true, onFetch: async (url) => (url.endsWith("/api/ask/chat") ? resp(401, { needLogin: true }) : null) });
    await h.ask("why");
    assert.match(h.els["umeboshi-ask-stream-status"].textContent, /エラー: 送信できませんでした \(401\)/);
  });

  it("設定 token がある 401 はログインの refresh を試さない（自己ホストでは無駄）", async () => {
    // OSS tree には module（login・billing・usage の実体）が無いので host 側だけ。
    // host 側では従来どおり refresh の抑止と試行を見る。
    if (!HAS_MODULE) return;
    let refreshN = 0;
     const onFetch = async (url) => {
      const r = await redeemOK(url);
      if (r) return r;
      if (url.endsWith("/api/ask/chat")) return chatSse(url);
      if (url.endsWith("/api/billing/link")) return resp(401, { error: "unauthorized" });
      if (url.endsWith("/api/auth/refresh")) { refreshN++; return resp(401, { error: "unauthorized" }); }
      return null;
    };
    const h = await drive({
      consent: true,
      script: MODULE_SCRIPT,
      // refresh token は持っているが、設定 token があるので refresh は無駄。
      localInit: { [TOKEN_KEY]: "s3cret", [REFRESH_KEY]: "r1" },
      onFetch,
    });
    await tick(12);
    // 起動直後の silentRefresh（refresh token 持ち）は既定挙動。billing 401 の前で数え直す。
    refreshN = 0;
    await h.redeem();
    // billing は module 側。authFetch 経由で 401 を踏ませる（/api/billing/link）。
    refreshN = 0;
    h.els["umeboshi-ask-billing-btn"].click();
    await tick(20);
    assert.equal(refreshN, 0, "設定 token があるのに refresh を試した");

    // usage の 401 経路も同じガードを持つ（設定 token が無いときだけ試す。usage は module 側）。
    const g = await drive({
      consent: true,
      script: MODULE_SCRIPT,
      localInit: { [REFRESH_KEY]: "r1" },
      onFetch: async (url) => {
        const r = await redeemOK(url);
        if (r) return r;
        if (url === HOOK + "/api/usage") return resp(401, { error: "unauthorized" });
        if (url.endsWith("/api/auth/refresh")) { refreshN++; return resp(200, { accessToken: "a2" }); }
        return null;
      },
    });
    await g.redeem();
    g.els["umeboshi-ask-settings-btn"].click();
    await tick(20);
    assert.ok(refreshN >= 1, "設定 token が無く refresh token があれば refresh は従来どおり試す");
  });
  it("既定（公式 URL）のままの panel の既存挙動が不変", async () => {
    // OSS tree には module（login の実体）が無いので host 側だけ。
    // host 側では従来どおり公式 URL の既存挙動を見る。
    if (!HAS_MODULE) return;
    const h = await drive({ consent: true, onFetch: chatOrRedeem });
    delete h.sandbox.UMEBOSHI_ASK_API_BASE;
    await h.redeem();
    await h.ask("why");
    assert.equal(h.chatCalls().at(-1).url, OFFICIAL + "/api/ask/chat");
    assert.equal(h.chatCalls().at(-1).init.headers.Authorization, "Bearer " + LOGIN_TOKEN);

    // 公式 URL のまま threads の保存・再読み込みもログイントークンで通る。
    let postBearer = "";
    const onFetch = async (url, init) => {
      const r = await redeemOK(url);
      if (r) return r;
      if (url.includes("/api/ask/threads/") && init?.method === "POST") {
        postBearer = init.headers.Authorization;
        const body = JSON.parse(init.body);
        return resp(200, { message: { id: "m1", question: body.question, answer: body.answer } });
      }
      if (url.includes("/api/ask/threads/") && (!init || init.method === "GET")) {
        return resp(200, { messages: [{ id: "m1", question: "Q?", answer: "A." }] });
      }
      return chatSse(url);
    };
    const t = await drive({ consent: true, onFetch });
    delete t.sandbox.UMEBOSHI_ASK_API_BASE;
    await t.redeem();
    t.sandbox.UmeboshiAskThread.save("Q?", "A.");
    await tick(12);
    assert.equal(postBearer, "Bearer " + LOGIN_TOKEN);
  });

  describe("面板の各コピー（雛形・base ビルド・注入版）で一致した動き", () => {
    for (const [name, script] of COPIES) {
      it(name + ": 設定の URL/token で接続先と Bearer が決まる", async () => {
        const h = await drive({
          consent: true,
          localInit: { [URL_KEY]: "https://mine.example", [TOKEN_KEY]: "s3cret" },
          onFetch: chatSse,
          script,
        });
        await h.ask("why");
        assert.equal(h.chatCalls().at(-1).url, "https://mine.example/api/ask/chat");
        assert.equal(h.chatCalls().at(-1).init.headers.Authorization, "Bearer s3cret");
      });

      it(name + ": 設定が空ならフック、フックも無ければ既定の公式 URL", async () => {
        const hook = await drive({ consent: true, onFetch: chatSse, script });
        await hook.ask("why");
        assert.equal(hook.chatCalls().at(-1).url, HOOK + "/api/ask/chat");
        assert.equal(hook.chatCalls().at(-1).init.headers.Authorization, undefined);

        const def = await drive({ consent: true, onFetch: chatSse, script });
        delete def.sandbox.UMEBOSHI_ASK_API_BASE;
        await def.ask("why");
        assert.equal(def.chatCalls().at(-1).url, OFFICIAL + "/api/ask/chat");
      });

      it(name + ": 誤 token の 401 に workerTokenInvalid を出す", async () => {
        const h = await drive({
          consent: true,
          localInit: { [TOKEN_KEY]: "wrong" },
          onFetch: async (url) => (url.endsWith("/api/ask/chat") ? resp(401, { needLogin: true }) : null),
          script,
        });
        await h.ask("why");
        assert.match(h.els["umeboshi-ask-stream-status"].textContent, /設定のアクセストークンを確認してください/);
      });

      it(name + ": currentApiBase/bearerToken の解決が同じ形で入っている", () => {
        // 注入版は billing module の script seam が入るので本文は増えるが、
        // 接続先・Bearer の解決そのものは各コピーで同一でなければならない。
        // module は自分の呼び出しも base の resolver に寄せる（usage・課金表示）。
        const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
        const def = (code, fn) => {
          const m = code.match(new RegExp("function " + fn + "\\(\\)[\\s\\S]*?\\n  }"));
          return m ? m[0] : "";
        };
        const base = strip(TEMPLATE_SCRIPT);
        const want = strip(script);
        assert.match(want, /function currentApiBase\(\)[\s\S]*?return DEFAULT_API_BASE;/);
        assert.equal(def(want, "currentApiBase"), def(base, "currentApiBase"),
          "currentApiBase の本文が雛形と違う");
        assert.equal(def(want, "bearerToken"), def(base, "bearerToken"),
          "bearerToken の本文が雛形と違う");
        assert.doesNotMatch(want, /\bapiBase\b/, "読み込み時の apiBase snapshot が残っている");
        assert.ok(want.includes("readWorkerUrl()"), "設定 URL の読みが無い");
        assert.ok(want.includes("readWorkerToken()"), "設定 token の読みが無い");
        assert.equal((want.match(/function bearerToken\(\)/g) || []).length, 1);
      });
    }

    it("注入版の billing module も接続先の解決を base の resolver に寄せる", () => {
      // OSS tree には module が無いので host 側だけ。
      // host 側では従来どおり module の resolver 寄せを見る。
      if (!HAS_MODULE) return;
      // module が自分で URL を組み立て直すと、自己ホストの設定が課金表示だけ
      // 効かないコピーが生まれる。usage の呼び出しは currentApiBase() 経由。
      const mod = SRC("src/commercial/panel-module.js");
      assert.ok(mod.includes('currentApiBase() + "/api/usage"'), "module の usage が resolver 経由でない");
      assert.ok(mod.includes("bearerToken()"), "module が Bearer の解決を素通りしている");
    });
  });
});
