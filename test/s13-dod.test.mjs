import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { panelScript } from "./lib/panel-script.mjs";
import { buildPanel } from "../addon/inject-build.mjs";

// S13 (#14) DoD end-to-end auto gate. First half drives behavior via EJS->vm
// (same shape as #18 test/auth-addon.test.mjs); second half pins the 18 DoD items.
// Humans run 3-env real devices (HITL) via the docs/dod-v1.5.3.md §2 runbook.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const BUILT = path.join(REPO, "addon/templates/inject.html");
const DOD = path.join(REPO, "docs/dod-v1.5.3.md");
const SRC = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
// Body with comments stripped. Read this when counting "absent from code".
// (Line comments start at line head; `/* ... */` assumed non-nested. `//` inside strings stays.)
const SRC_CODE = (p) =>
  SRC(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// Card JS source can be swapped. Apply the same regression suite as-is to live
// templates (AnkiConnect captures) or Note Type build output.
// e.g. ASK_SCRIPT_FILE=".harness/tmp/live/umeboshi-ask.Cloze.back.html" node --test test/
// Default is scaffold + partial (askRenderer.ejs) joined in include order.
const SCRIPT = panelScript({ from: process.env.ASK_SCRIPT_FILE });
// OSS tree has no module. Without it, fall back to base as the injected build.
// On host, keep reading the injected build as before.
const HAS_MODULE = fs.existsSync(path.join(REPO, "src/commercial/panel-module.js"));
const HOST_SCRIPT = process.env.ASK_SCRIPT_FILE ? panelScript({ from: process.env.ASK_SCRIPT_FILE }) : panelScript({ module: HAS_MODULE });
const BUILT_HTML = SRC("addon/templates/inject.html");
const BUILT_HOST_HTML = buildPanel(REPO, { module: HAS_MODULE });

const IDS = [
  "umeboshi-ask-auth-status", "umeboshi-ask-account-status", "umeboshi-ask-addon-guide",
  "umeboshi-ask-login-btn", "umeboshi-ask-logout-btn", "umeboshi-ask-redeem-row",
  "umeboshi-ask-code-input", "umeboshi-ask-redeem-btn", "umeboshi-ask-export-btn",
  "umeboshi-ask-import-btn", "umeboshi-ask-migrate-status", "umeboshi-ask-migrate-login-hint",
  "umeboshi-ask-send-btn", "umeboshi-ask-save-btn", "umeboshi-ask-cardid-banner",
  // #127 origin-reset notice banner. Same red-style slot as the CardID banner.
  "umeboshi-ask-storage-banner",
  "umeboshi-ask-consent-modal", "umeboshi-ask-settings-modal", "umeboshi-ask-models-status",
  "umeboshi-ask-input", "umeboshi-ask-send-hint", "umeboshi-ask-settings-body",
  "umeboshi-ask-ankidroid-kb-hint",
  "umeboshi-ask-settings-tabs", "umeboshi-ask-settings-search", "umeboshi-ask-search-hint",
  "umeboshi-ask-detailbar", "umeboshi-ask-detail-back", "umeboshi-ask-detail-src",
  "umeboshi-ask-detail-title", "umeboshi-ask-results", "umeboshi-ask-consent-status",
  "umeboshi-ask-age-check", "umeboshi-ask-age-check-label", "umeboshi-ask-withdraw-note", "umeboshi-ask-consent-agree", "umeboshi-ask-consent-later", "umeboshi-ask-consent-withdraw", "umeboshi-ask-consent-title",
  // #133 consent dialog body. Slot to check CONSENT_EN under en UI.
  "umeboshi-ask-consent-body",
  "umeboshi-ask-card-id", "umeboshi-ask-buttons", "umeboshi-ask-model",
  "umeboshi-ask-model-popup", "umeboshi-ask-model-backdrop", "umeboshi-ask-model-sheet", "umeboshi-ask-model-sheet-head",
  "umeboshi-ask-model-sheet-title", "umeboshi-ask-model-close", "umeboshi-ask-model-back", "umeboshi-ask-model-list", "umeboshi-ask-model-label",
  "umeboshi-ask-effort-popup", "umeboshi-ask-effort-backdrop", "umeboshi-ask-effort-sheet", "umeboshi-ask-effort-sheet-head",
  "umeboshi-ask-effort-sheet-title", "umeboshi-ask-effort-close", "umeboshi-ask-effort-back", "umeboshi-ask-effort-list", "umeboshi-ask-effort-note",
  // #198 4-tier (ModelTier) popup. Slot behind the model button.
  "umeboshi-ask-tier-popup", "umeboshi-ask-tier-backdrop", "umeboshi-ask-tier-sheet", "umeboshi-ask-tier-sheet-head",
  "umeboshi-ask-tier-sheet-title", "umeboshi-ask-tier-close", "umeboshi-ask-tier-list",
  "umeboshi-ask-tier-foot", "umeboshi-ask-tier-detail-btn",
  "umeboshi-ask-credit-status", "umeboshi-ask-credit-refresh",
  "umeboshi-ask-credit-notice",
  // #160 billing entry is the /billing dashboard only. URL field stays just for that route.
  "umeboshi-ask-billing-btn",
  "umeboshi-ask-billing-login-hint",
  "umeboshi-ask-billing-status",
  "umeboshi-ask-settings-btn", "umeboshi-ask-settings-close", "umeboshi-ask-prompt-list",
  "umeboshi-ask-custom-list", "umeboshi-ask-current", "umeboshi-ask-thinking",
  "umeboshi-ask-thinking-body", "umeboshi-ask-answer", "umeboshi-ask-stream-status", "umeboshi-ask-stream-q",
  "umeboshi-ask-thread", "umeboshi-ask-thread-list",
  "umeboshi-ask-thread-status", "umeboshi-ask-messages", "umeboshi-ask-input-row",
  "umeboshi-ask-drawer", "umeboshi-ask-search-clear", "umeboshi-ask-lang-status",
  "umeboshi-ask-reset-all", "umeboshi-ask-reset-prompts",
  // #129 static 8-item headings plus label/state/description slots.
  "umeboshi-ask-title-sendmode", "umeboshi-ask-title-consent", "umeboshi-ask-title-reset",
  "umeboshi-ask-title-lang", "umeboshi-ask-title-account", "umeboshi-ask-title-migrate",
  "umeboshi-ask-title-credit", "umeboshi-ask-title-billing",
  // #256 OS2b self-host route: endpoint URL and access token.
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
function sseResp(lines) {
  return { ok: true, status: 200, text: async () => lines.join("\n"), json: async () => ({}) };
}
const sseLine = (obj) => "data: " + JSON.stringify(obj);
// #87: stoppable stream. Empty array means zero generation.
function sseStreamResp(lines, signal) {
  let i = 0;
  const enc = (t) => new TextEncoder().encode(t);
  const abortErr = () => { const e = new Error("aborted"); e.name = "AbortError"; return e; };
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => lines.join("\n"),
    body: {
      getReader: () => ({
        read: () => {
          if (signal && signal.aborted) return Promise.reject(abortErr());
          if (i < lines.length) {
            const c = lines[i++];
            return new Promise((res) => setTimeout(() => res({ done: false, value: enc(c + "\n\n") }), 5));
          }
          return new Promise((_res, rej) => {
            if (!signal) return;
            signal.addEventListener("abort", () => rej(abortErr()), { once: true });
          });
        },
        cancel: () => {},
      }),
    },
  };
}

const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function drive(opts = {}) {
  const {
    platform = "web",
    cardId = "1234567890123",
    consent = false,
    bodyClass = "",
    rawText = "",
    onFetch = null,
    localInit = {},
    ua = "",
    panels = [],
    // #127 origin-change probe. port = card origin port, cookieInit = previous port.
    port = "",
    cookieInit = "",
    // #281 swapped-consent SCRIPT inlet. Swap only the in-VM body text while
    // keeping CONSENT_POLICY_VERSION so the hash-mismatch state is reproduced.
    script = SCRIPT,
    // AnkiDroidJS.getLanguage() beats UA (#42 detection order). Used for en-UI repro.
    ankiLang = "ja",
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
  // Seed 5 static buttons like real HTML (S1-compat gate wiring target)
  for (const key of ["why", "what", "significance", "origin", "eli5"]) {
    const b = new FakeEl("");
    b.setAttribute("data-ask", key);
    els["umeboshi-ask-buttons"].appendChild(b);
  }
  const doc = {
    getElementById: (id) => els[id] || null,
    createElement: () => new FakeEl(""),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    querySelectorAll: (sel) => {
      if (typeof sel === "string" && sel.includes("#umeboshi-ask-buttons") && sel.includes("data-ask")) {
        const box = els["umeboshi-ask-buttons"];
        const customOnly = sel.includes("data-ask-custom");
        return (box?.children || []).filter((c) => customOnly
          ? c.getAttribute("data-ask-custom")
          : c.getAttribute("data-ask"));
      }
      if (typeof sel === "string" && sel.includes("#umeboshi-ask-settings-body")) {
        return sel.includes(".umeboshi-ask-item")
          ? panels.flatMap((w) => w.items)
          : panels.map((w) => w.panel);
      }
      return [];
    },
    querySelector: () => null,
    addEventListener: () => {},
    body: { className: bodyClass },
    // #127 Cookie is port-unscoped and survives (RFC 6265 §5.3). Minimal jar joining "name=value; ...".
    _cookie: cookieInit,
    get cookie() { return this._cookie; },
    set cookie(v) {
      const pair = String(v).split(";")[0];
      const name = pair.split("=")[0].trim();
      const rest = (this._cookie ? this._cookie.split("; ") : []).filter((c) => c && !c.startsWith(name + "="));
      rest.push(pair);
      this._cookie = rest.join("; ");
    },
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
  // #127 card origin is http://127.0.0.1:<port>/. Port is part of origin, the detection focus.
  sandbox.location = { port };
  sandbox.navigator = { language: "ja-JP", userAgent: ua };
  sandbox.UMEBOSHI_ASK_API_BASE = "https://test.example";
  if (platform === "desktop") sandbox.ankiPlatformInfo = { language: "ja" };
  if (platform === "droid") sandbox.AnkiDroidJS = { getLanguage: () => ankiLang };
  sandbox.open = () => {};
  sandbox.confirm = () => true;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: "askScaffold.js" });
  await tick();
  /* #281 seed consented state via the real write path. Hand-writing localStorage "h"
     skips readConsentRecord body-hash check and would pin "record exists but wrong
     consentTextHash still passes". */
  if (consent && !("umeboshi-ask:consent:v1" in localInit)) {
    els["umeboshi-ask-age-check"].checked = true;
    els["umeboshi-ask-consent-agree"].click();
    await tick();
  }

  return {
    sandbox, els, local, calls,
    cookieJar: () => doc.cookie,
    chatCalls: () => calls.filter((c) => c.url.endsWith("/api/ask/chat")),
    chatBody: () => {
      const c = calls.filter((x) => x.url.endsWith("/api/ask/chat")).at(-1);
      return c ? JSON.parse(c.init.body) : null;
    },
    threadsPosts: () => calls.filter((c) => c.url.includes("/api/ask/threads") && c.init?.method === "POST"),
    async agree() { if (els["umeboshi-ask-age-check"]) els["umeboshi-ask-age-check"].checked = true; els["umeboshi-ask-consent-agree"].click(); await tick(); },
    async ask(key) {
      const box = els["umeboshi-ask-buttons"];
      const btn = box.children.find((c) => c.getAttribute("data-ask") === key);
      assert.ok(btn, "static button " + key);
      // #25 single gate: box delegation owns consent + real send (browser-bubbling equivalent)
      for (const fn of box._ls["click"] || []) fn.call(box, { target: btn });
      await tick(12);
    },
    async redeem(code = "ABCDEFGHIJ1234567890") {
      els["umeboshi-ask-code-input"].value = code;
      els["umeboshi-ask-redeem-btn"].click();
      await tick(12);
    },
    // Fire runSearch on the search box input event and return the hint text as-is.
    search(q) {
      const input = els["umeboshi-ask-settings-search"];
      input.value = q;
      for (const fn of input._ls["input"] || []) fn.call(input, {});
      return els["umeboshi-ask-search-hint"].textContent;
    },
  };
}

// #130 settings tabs (panels) and item rows. Fake elements standing in for screen DOM.
// Keep the same parent-child shape (item.parentNode carries data-panel) or
// panelNameOf() cannot resolve tab names, breaking search totals and sub-display checks.
function fakeItem(title, subkey) {
  const it = new FakeEl("");
  it.setAttribute("data-title", title);
  it.setAttribute("data-search", title);
  if (subkey) it.setAttribute("data-subkey", subkey);
  it.textContent = title;
  return it;
}
function fakePanel(name, items) {
  const menu = new FakeEl("");
  const panel = new FakeEl("");
  panel.setAttribute("data-panel", name);
  for (const it of items) panel.appendChild(it);
  panel.querySelector = (sel) => (sel === '[data-menu="' + name + '"]' ? menu : null);
  panel.querySelectorAll = (sel) => (sel === ".umeboshi-ask-item" ? items : []);
  return { panel, menu, items };
}
// menuRow() is button > span.t > (heading + small). Read small as the "sub display".
function rowSubs(panel) {
  return panel.menu.children.map((row) => {
    const span = row.children[0];
    const small = (span.children || [])[0];
    return small ? small.textContent : "";
  });
}

function redeemOK(access = "a1", refresh = "r1") {
  return async (url) => {
    if (url.endsWith("/api/auth/redeem")) return resp(200, { accessToken: access, refreshToken: refresh });
    return null;
  };
}

describe("S13 7シナリオ（フロント振る舞い）", () => {
  it("①送信payloadは{question}のみ。保存済み解説・thinkingは送らない（D11/ADR 0006）", async () => {
    const h = await drive({ consent: true, onFetch: async (url) => {
      if (url.endsWith("/api/ask/chat")) return sseResp([sseLine({ type: "done" })]);
      return null;
    }});
    await h.ask("why");
    const b = h.chatBody();
    assert.ok(b && typeof b.question === "string");
    assert.match(b.question, /カード文脈/);
    assert.ok(!("historyMessages" in b));
    assert.ok(!("thinking" in b));
    const last = h.chatCalls().at(-1);
    assert.equal(last.init.headers["x-card-id"], "1234567890123");
  });

  it("①ストリーミング：thinking→content→doneで回答と折りたたみ根拠が表示される（D8）", async () => {
    const h = await drive({ consent: true, onFetch: async (url) => {
      if (url.endsWith("/api/ask/chat")) return sseResp([
        sseLine({ type: "thinking", delta: "根拠メモ" }),
        sseLine({ type: "content", delta: "こんにちは。" }),
        sseLine({ type: "done" }),
      ]);
      return null;
    }});
    await h.ask("what");
    assert.equal(h.els["umeboshi-ask-answer"].textContent, "こんにちは。");
    assert.equal(h.els["umeboshi-ask-thinking-body"].textContent, "根拠メモ");
    assert.equal(h.els["umeboshi-ask-stream-status"].textContent, "");
  });

  it("①CardID未対応は赤バナー＋保存ブロック（D1）", async () => {
    const h = await drive({ consent: true, cardId: "{{CardID}}" });
    assert.equal(h.els["umeboshi-ask-cardid-banner"].hidden, false);
    assert.equal(h.els["umeboshi-ask-save-btn"].disabled, true);
    assert.match(h.els["umeboshi-ask-save-btn"].title, /CardID未対応/);
    h.sandbox.UmeboshiAskThread.save("Q?", "A.");
    await tick();
    assert.match(h.els["umeboshi-ask-thread-status"].textContent, /未対応/);
  });

  /* #127 AnkiDroid changes origin (port) per deck, wiping localStorage each time.
     Cookies are port-unscoped, so a differing previous port proves the origin change. */
  it("#127 origin変更の証明：Cookieに前ポートあり＋別ポート＋localStorage空 → 告知バナー", async () => {
    const h = await drive({ platform: "droid", port: "40001", cookieInit: "ask_origin=39987" });
    assert.equal(h.els["umeboshi-ask-storage-banner"].hidden, false);
    assert.match(h.els["umeboshi-ask-storage-banner"].textContent, /localStorage/);
    assert.match(h.els["umeboshi-ask-storage-banner"].textContent, /不具合回避策/);
  });

  it("#127 初回起動は比較対象が無いので断定しない（バナー不出）", async () => {
    const h = await drive({ platform: "droid", port: "40001", cookieInit: "" });
    assert.equal(h.els["umeboshi-ask-storage-banner"].hidden, true);
  });

  it("#127 同一ポートなら origin は変わっていません（固定設定済み）", async () => {
    const h = await drive({ platform: "droid", port: "39987", cookieInit: "ask_origin=39987" });
    assert.equal(h.els["umeboshi-ask-storage-banner"].hidden, true);
  });

  it("#127 Desktop は対象外：ポートが同じで見ても案内しない（既存 add-on 導線に任せる）", async () => {
    const h = await drive({ platform: "desktop", port: "40001", cookieInit: "ask_origin=39987" });
    assert.equal(h.els["umeboshi-ask-storage-banner"].hidden, true);
  });

  it("#127 ポートが変わっても localStorage に生きたデータがあれば origin 判定を棄却", async () => {
    const h = await drive({
      platform: "droid", port: "40001", cookieInit: "ask_origin=39987",
      localInit: { "umeboshi-ask:settings:v1": "{}" },
    });
    assert.equal(h.els["umeboshi-ask-storage-banner"].hidden, true);
  });

  it("#127 告知は保存も送信も止めない（温和モード）", async () => {
    let chatN = 0;
    const h = await drive({ consent: true, platform: "droid", port: "40001", cookieInit: "ask_origin=39987",
      onFetch: async (url) => {
        if (url.endsWith("/api/ask/chat")) { chatN++; return sseResp([sseLine({ type: "done" })]); }
        return null;
      }});
    assert.equal(h.els["umeboshi-ask-storage-banner"].hidden, false);
    assert.equal(h.els["umeboshi-ask-save-btn"].disabled, false);
    await h.ask("why");
    assert.equal(chatN, 1, "告知が出ているのに送信が塞がれている");
  });

  it("#127 起動時に現在のポートを Cookie に残す（次回セッションの比較対象）", async () => {
    const h = await drive({ platform: "droid", port: "40001", cookieInit: "ask_origin=39987" });
    assert.match(h.cookieJar(), /ask_origin=40001/);
  });

  it("#127 英語UIでも同じ告知文言に切り替わる", async () => {
    const h = await drive({ platform: "droid", port: "40001", cookieInit: "ask_origin=39987", ankiLang: "en" });
    assert.match(h.els["umeboshi-ask-storage-banner"].textContent, /localStorage in Study Screen/);
  });

  it("④中断→手動保存：送信兼停止で「中断しました」＋未保存Message残存＋保存ボタン。自動保存はしない（D3④）", async () => {
    const h = await drive({ consent: true, onFetch: async (url, init) => {
      if (url.endsWith("/api/ask/chat")) {
        return sseStreamResp([
          sseLine({ type: "thinking", delta: "まず" }),
          sseLine({ type: "content", delta: "答えは42です" }),
        ], init?.signal);
      }
      return null;
    }});
    await h.ask("why");
    await sleep(80);
    assert.match(h.els["umeboshi-ask-send-btn"].textContent, /停止/);
    h.els["umeboshi-ask-send-btn"].click();
    await sleep(80);
    assert.equal(h.els["umeboshi-ask-stream-status"].textContent, "中断しました");
    const msgs = textOf(h.els["umeboshi-ask-messages"]);
    assert.match(msgs, /答えは42です/);
    assert.match(msgs, /未保存/);
    assert.ok(msgs.includes("保存"));
    assert.equal(h.threadsPosts().length, 0);
  });

  it("④b中断→生成0：Message を作らず「中断しました」1行だけ（#87）", async () => {
    const h = await drive({ consent: true, onFetch: async (url, init) => {
      if (url.endsWith("/api/ask/chat")) return sseStreamResp([], init?.signal);
      return null;
    }});
    await h.ask("why");
    await sleep(80);
    h.els["umeboshi-ask-send-btn"].click();
    await sleep(80);
    assert.equal(h.els["umeboshi-ask-stream-status"].textContent, "中断しました");
    assert.equal(h.els["umeboshi-ask-messages"].children.length, 0);
    assert.equal(h.els["umeboshi-ask-current"].hidden, false);
    assert.equal(h.threadsPosts().length, 0);
  });
  it("icon: 送信・保存に内蔵SVGが付き外部参照なし（#41修正）", async () => {
    const h = await drive({ consent: true });
    for (const id of ["umeboshi-ask-send-btn", "umeboshi-ask-settings-btn"]) {
      const btn = h.els[id];
      const ic = btn.children.find((c) => c.className === "umeboshi-ask-ic");
      assert.ok(ic, id + "にicon span");
      assert.match(ic.innerHTML, /<svg viewBox="0 0 24 24"/);
      assert.match(ic.innerHTML, /<path d="/);
    }
    const save = h.sandbox.UmeboshiAskThread;
    assert.ok(save, "thread api");
  });

  it("⑤15秒切替：switched通知はプレーン文面で1度だけ（D3⑤/D18）", async () => {
    const h = await drive({ consent: true, onFetch: async (url) => {
      if (url.endsWith("/api/ask/chat")) return sseResp([
        sseLine({ type: "switched", to: "model-b" }),
        sseLine({ type: "switched", to: "model-c" }),
        sseLine({ type: "done" }),
      ]);
      return null;
    }});
    await h.ask("why");
    assert.equal(h.els["umeboshi-ask-models-status"].textContent, "モデルを切り替えました: model-b");
  });

  it("⑥Cloze複数差分：c1/c2/c3が個別に渡り、当該カードが明示される（D3⑥）", async () => {
    const h = await drive({
      consent: true, bodyClass: "card2",
      rawText: "前{c1::AAA}中{c2::BBB}後{c3::CCC}",
      onFetch: async (url) => {
        if (url.endsWith("/api/ask/chat")) return sseResp([sseLine({ type: "done" })]);
        return null;
      },
    });
    await h.ask("why");
    const q = h.chatBody().question;
    assert.match(q, /c1/);
    assert.match(q, /c2（このカード）/);
    assert.match(q, /c3/);
  });

  it("⑦ELI5：5歳向けテンプレで送信される（D3⑦）", async () => {
    const h = await drive({ consent: true, onFetch: async (url) => {
      if (url.endsWith("/api/ask/chat")) return sseResp([sseLine({ type: "done" })]);
      return null;
    }});
    await h.ask("eli5");
    assert.match(h.chatBody().question, /5歳/);
  });

  // #256 OS2b: 2 values wiring to a self-hosted Worker (URL + access token).
  // Never sent to the server, so stored under separate keys from settings JSON (SETTINGS_KEY).
  // Blank default keeps the existing hook > default-URL route.
  describe("#256 OS2b 接続先Workerとアクセストークン", () => {
    const URL_KEY = "umeboshi-ask:worker-url:v1";
    const TOKEN_KEY = "umeboshi-ask:worker-token:v1";
    const openModal = async (h) => {
      h.els["umeboshi-ask-settings-btn"].click();
      await tick(12);
    };
    const fire = (el, type) => {
      for (const fn of el._ls[type] || []) fn.call(el, { target: el });
    };

    it("保存済みの値が入力欄へ戻り、見出しはUI言語に追従する", async () => {
      const h = await drive({
        localInit: { [URL_KEY]: "https://ask.example.com", [TOKEN_KEY]: "tok" },
      });
      await openModal(h);
      assert.equal(h.els["umeboshi-ask-worker-url"].value, "https://ask.example.com");
      assert.equal(h.els["umeboshi-ask-worker-token"].value, "tok");
      assert.equal(h.els["umeboshi-ask-title-workerurl"].textContent, "接続先Worker");
      assert.equal(h.els["umeboshi-ask-title-workertoken"].textContent, "アクセストークン");

      const en = await drive({
        localInit: {
          "umeboshi-ask:settings:v1": JSON.stringify({ version: 1, sendMode: "button", lang: "en" }),
          [URL_KEY]: "https://ask.example.com",
        },
      });
      await openModal(en);
      assert.equal(en.els["umeboshi-ask-title-workerurl"].textContent, "Worker endpoint");
      assert.equal(en.els["umeboshi-ask-title-workertoken"].textContent, "Access token");
    });

    it("change で2キーに保存され、その値だけを持つ panel が復元する（再読み込み後も残る）", async () => {
      const h = await drive({});
      await openModal(h);
      const url = h.els["umeboshi-ask-worker-url"];
      url.value = "https://mine.example";
      fire(url, "change");
      await tick();
      assert.equal(h.local.getItem(URL_KEY), "https://mine.example");
      const tok = h.els["umeboshi-ask-worker-token"];
      tok.value = "  s3cret  ";
      fire(tok, "change");
      await tick();
      // Trim surrounding whitespace (Worker validates the content).
      assert.equal(h.local.getItem(TOKEN_KEY), "s3cret");

      const again = await drive({
        localInit: { [URL_KEY]: "https://mine.example", [TOKEN_KEY]: "s3cret" },
      });
      await openModal(again);
      assert.equal(again.els["umeboshi-ask-worker-url"].value, "https://mine.example");
      assert.equal(again.els["umeboshi-ask-worker-token"].value, "s3cret");
    });

    it("空欄と壊れたURLは既定に戻る。壊れた値のときだけ案内を出す", async () => {
      const h = await drive({ localInit: { [URL_KEY]: "https://mine.example" } });
      await openModal(h);
      const url = h.els["umeboshi-ask-worker-url"];
      url.value = "not-a-url";
      fire(url, "change");
      await tick();
      assert.equal(h.local.getItem(URL_KEY), null);
      assert.equal(url.value, "");
      assert.match(h.els["umeboshi-ask-worker-url-note"].textContent, /既定の公式Workerに戻しました/);

      // No notice when a broken value is merely rewritten back to blank.
      url.value = "https://mine.example";
      fire(url, "change");
      await tick();
      url.value = "";
      fire(url, "change");
      await tick();
      assert.equal(h.local.getItem(URL_KEY), null);
      assert.equal(h.els["umeboshi-ask-worker-url-note"].textContent, "");
    });

    it("設定同期（export）の body に Worker URL とアクセストークンが含まれない", async () => {
      let sent = null;
      const h = await drive({
        consent: true,
        localInit: { [URL_KEY]: "https://mine.example", [TOKEN_KEY]: "s3cret" },
        onFetch: async (url, init) => {
          if (url.endsWith("/api/settings") && init && init.method === "POST") {
            sent = JSON.parse(init.body);
            return resp(200, { ok: true });
          }
          return null;
        },
      });
      h.els["umeboshi-ask-export-btn"].click();
      await tick(12);
      assert.ok(sent, "export が settings へ POST する");
      const body = JSON.stringify(sent);
      assert.doesNotMatch(body, /s3cret/);
      assert.doesNotMatch(body, /mine\.example/);
    });
  });

  it("#45 回帰: itemKey定義漏れでもモーダル内メニュー行のドリルインが落ちない", async () => {
    // Without itemKey, openDetail openDesc assembly throws ReferenceError and row taps look dead.
    const defs = (SCRIPT.match(/function itemKey\s*\(/g) || []).length;
    assert.equal(defs, 1);
    const staticItems = [...SRC("src/components/askScaffold.ejs").matchAll(/class="umeboshi-ask-item"[^>]*data-title="([^"]+)"/g)].map((m) => m[1]);
    // Static items use data-title as key (unique: stable key for drill-in restore).
    // OS5b consent item comes from module markup:consent-item.
    // OS5c account item comes from module markup:account-item. base floor is 6.
    // Injected build adds module's 5 rows (consent + account + OS5a balance/plan-billing) for 11 total.
    // Pin both as duplicate-free.
    assert.ok(staticItems.length >= 6, "base の静的項目の床は6");
    assert.equal(new Set(staticItems).size, staticItems.length);
    // OSS tree has no module, so injected extra rows are host-only.
    // On host, keep checking module's 4 rows as before.
    if (HAS_MODULE) {
      assert.ok(BUILT_HOST_HTML.includes('data-title="プライバシーポリシーへの同意"'),
        "注入版に同意の data-title 行が無い");
      assert.ok(BUILT_HOST_HTML.includes('data-title="アカウント"'),
        "注入版にアカウントの data-title 行が無い");
      const hostItems = [...BUILT_HOST_HTML.matchAll(/class="umeboshi-ask-item"[^>]*data-title="([^"]+)"/g)].map((m) => m[1]);
      assert.deepEqual(
        hostItems.filter((t) => !staticItems.includes(t)).sort(),
        ["アカウント", "クレジット残量", "プラン・課金", "プライバシーポリシーへの同意"].sort(),
        "注入版の追加行は module の4行だけ",
      );
    }
    // itemTitle drops blank data-title and falls back to heading (prevents blank rows).
    assert.ok(SCRIPT.includes("trim(t) !== "));
    assert.ok(SCRIPT.includes('querySelector(".umeboshi-ask-item-title")'));
    assert.ok(SCRIPT.includes("itemFallback"));
  });

  // #129: LOCALES long had both ja/en values but they were never wired to screen.
  // Counting key "presence" cannot catch it, so compare real textContent.
  it("言語検出：明示＞Desktop＞Droid＞navigator＞ENの順（D17・#42日英のみ）", async () => {
    const web = await drive({});
    const I18n = web.sandbox.UmeboshiAskI18n;
    assert.equal(I18n.detectLang({ lang: "en" }).lang, "en");
    assert.equal(I18n.normalizeLang("es-ES"), "en");
    assert.equal(I18n.normalizeLang("zh-TW"), "en");
    assert.equal(I18n.normalizeLang("ja-JP"), "ja");
    assert.equal(I18n.detectLang({ lang: "auto" }).source, "navigator");
    assert.equal(I18n.detectLang({ lang: "auto" }).lang, "ja");
    assert.equal(I18n.detectLang({ lang: "es" }).source, "navigator");
    assert.equal(I18n.detectLang({ lang: "zh-CN" }).source, "navigator");
    const desk = await drive({ platform: "desktop" });
    assert.equal(desk.sandbox.UmeboshiAskI18n.detectLang({ lang: "auto" }).source, "anki-desktop");
    const droid = await drive({ platform: "droid" });
    assert.equal(droid.sandbox.UmeboshiAskI18n.detectLang({ lang: "auto" }).source, "ankidroid");
  });

  it("#96 AnkiDroid：タップでIMEが出ない件の案内をAnkiDroidだけで出す", async () => {
    // AnkiDroid builds the reviewer WebView with
    // `isFocusableInTouchMode = typeAnswer.useInputTag` and useInputTag defaults
    // to false: a card's own <textarea> takes the caret and never the keyboard.
    // Card JS cannot read or flip that switch (TypeAnswer reads SharedPreferences,
    // and the JS API has no keyboard command), so the card has to name it — and
    // only on the platform where the reader can act on it.
    const id = "umeboshi-ask-ankidroid-kb-hint";
    const droid = await drive({ platform: "droid" });
    assert.equal(droid.els[id].hidden, false, "AnkiDroid には案内を出す");
    assert.match(droid.els[id].textContent, /答えを入力する欄をカード内に表示/, "案内は AnkiDroid の設定名そのもの");
    // The JS bridge may be absent, so the Android WebView UA has to count too.
    const uaOnly = await drive({ ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36" });
    assert.equal(uaOnly.els[id].hidden, false, "Android UA だけでも AnkiDroid と見る");
    assert.equal((await drive({})).els[id].hidden, true, "ブラウザでは出さない");
    assert.equal((await drive({ platform: "desktop" })).els[id].hidden, true, "Desktop では出さない");
  });
});

// #130 brackets/separators/search phrasing follow the UI language.
// Key "presence" in the phrase table is not a check, so compare on-screen strings.
describe("#130 括弧・区切り・検索の語法をUI言語に追従させる", () => {
  const init = (lang) => ({ "umeboshi-ask:settings:v1": JSON.stringify({ version: 1, sendMode: "button", lang }) });
  const KEYS = ["punctOpen", "punctClose", "punctDot", "searchQuote", "countIn", "punctStop"];
  // 2 general + 1 lang row visible at once. Rows hit search via "item".
  const buildPanels = () => {
    const general = fakePanel("general", [fakeItem("General item"), fakeItem("Second item")]);
    const lang = fakePanel("lang", [fakeItem("Lang item", "lang")]);
    return { general, lang, all: [general, lang] };
  };

  it("LOCALESに共通キーが日英で揃い、括弧と区切りは言語ごとに違う", async () => {
    const h = await drive({});
    const ja = h.sandbox.UmeboshiAskI18n.uiText("ja");
    const en = h.sandbox.UmeboshiAskI18n.uiText("en");
    for (const k of KEYS) {
      assert.equal(typeof ja[k], "string", "ja に " + k + " が無い");
      assert.equal(typeof en[k], "string", "en に " + k + " が無い");
      assert.notEqual(ja[k], en[k], k + " の英日が同じ値（英語UIで日本語が出る）");
    }
    assert.equal(ja.punctOpen, "（"); assert.equal(en.punctOpen, " (");
    assert.equal(ja.punctClose, "）"); assert.equal(en.punctClose, ")");
    assert.equal(ja.punctDot, "・"); assert.equal(en.punctDot, ", ");
    assert.equal(ja.searchQuote, "「」"); assert.equal(en.searchQuote, "\"\"");
  });

  it("言語の項目行のサブ表示: 英語UIは en (Manual)、日本語UIはja（明示設定）", async () => {
    for (const lang of ["ja", "en"]) {
      const p = buildPanels();
      await drive({ localInit: init(lang), panels: p.all });
      // Lang tab row 1 carries data-subkey="lang" (drawn at init by buildAllMenus).
      assert.deepEqual(rowSubs(p.lang), [
        (lang === "ja" ? "ja（明示設定）" : "en (Manual)"),
      ], lang + "UIの言語行のサブ表示");
    }
  });

  it("言語設定のステータス行は英語UIで全角括弧を使わない", async () => {
    const en = await drive({ localInit: init("en") });
    const ja = await drive({ localInit: init("ja") });
    const id = "umeboshi-ask-lang-status";
    assert.equal(en.els[id].textContent, "Display language: en (Source: Manual)");
    assert.equal(ja.els[id].textContent, "表示言語: ja（取得元: 明示設定）");
    assert.doesNotMatch(en.els[id].textContent, /[（）]/, "英語UIに全角括弧が残っている");
  });

  it("検索の該当なし行: 英語UIは鉤括弧を使わない", async () => {
    const en = await drive({ localInit: init("en") });
    const ja = await drive({ localInit: init("ja") });
    assert.equal(en.search("zzzz"), "\"zzzz\" — no matching settings");
    assert.equal(ja.search("zzzz"), "「zzzz」に一致する設定はありません");
    assert.doesNotMatch(en.search("zzzz"), /[「」]/, "英語UIに鉤括弧が残っている");
  });

  it("検索の件数: 英語UIは General (2)、日本語UIは 一般に 2件。区切りも言語に追従する", async () => {
    for (const lang of ["ja", "en"]) {
      const p = buildPanels();
      const h = await drive({ localInit: init(lang), panels: p.all });
      const hint = h.search("item");
      assert.equal(hint, lang === "ja"
        ? "「item」: 一般に 2件・言語に 1件 見つかりました"
        : "\"item\": General (2), Language (1) found");
      // Ja-UI corner/fullwidth brackets are legit. En-side marks (parens/commas) must not leak in.
      assert.doesNotMatch(hint, lang === "ja" ? /[(,)]/ : /[「」・（）]/, lang + "UIの検索ヒントに他言語の記号が残っている");
      // Result rows read "tab-name separator item-sub". Tab name and separator both follow UI lang.
      assert.equal(rowSubs(p.general).length, 2, "一般タブの行数");
      assert.equal(h.els["umeboshi-ask-results"].children[0].children[0].children[0].textContent,
        lang === "ja" ? "一般" : "General", lang + "UIの検索行のタブ名");
      assert.equal(h.els["umeboshi-ask-results"].children[2].children[0].children[0].textContent,
        lang === "ja" ? "言語・ja（明示設定）" : "Language, en (Manual)", lang + "UIの検索行のサブ表示");
    }
  });

  it("参照0の langSourceJa と日本語名の TAB_NAMES はコードから消えた", () => {
    assert.ok(!SCRIPT.includes("langSourceJa"), "langSourceJa が残っている");
    assert.ok(!SCRIPT.includes("TAB_NAMES"), "TAB_NAMES が残っている");
  });
});

// #132 credit row and model list punctuation/score aria-labels follow the UI language.
// Key "presence" in the phrase table is not a check, so compare on-screen strings ja vs en.
describe("#132 credit行とモデル一覧をUI言語に追従させる", () => {
  const init = (lang) => ({ "umeboshi-ask:settings:v1": JSON.stringify({ version: 1, sendMode: "button", lang }) });
  const text = (h, lang) => h.sandbox.UmeboshiAskI18n.uiText(lang);
  // Balance-row ja/en comparison (driveUsage) is billing DoD, covered host-side in
  // test/panel-billing-dod.test.mjs (OS5a).
  const MODELS = [{
    id: "m-cheap", name: "Cheap", priceUsdPer1M: 0.1, smartScore: 65, credits: 30,
    supportedEfforts: ["low", "high"], defaultEffort: "high",
  }];
  const driveModels = async (lang) => {
    const h = await drive({
      consent: true,
      localInit: init(lang),
      onFetch: async (url) => (url.endsWith("/api/ask/models") ? resp(200, { models: MODELS }) : null),
    });
    await tick(12);
    return h;
  };

  it("モデルラベル: 英語UIは半角括弧・日本語UIは全角。目安クレジットは出さない（#198）", async () => {
    const en = (await driveModels("en")).els["umeboshi-ask-model"].textContent;
    const ja = (await driveModels("ja")).els["umeboshi-ask-model"].textContent;
    assert.equal(en, "Cheap 🧠65 (High)");
    assert.equal(ja, "Cheap 🧠65（High）");
    assert.doesNotMatch(en, /[（）：・？]/, "英語UIのモデルラベルに日本語が残っている");
    assert.doesNotMatch(en, /credits/, "#198 目安クレジットは選ぶ画面に出さない");
  });

  it("モデルのスコアの aria-label はUI言語で、日英で値が違う", async () => {
    const score = async (lang) => {
      const h = await driveModels(lang);
      return h.els["umeboshi-ask-model-list"].children[0].children[0].children[2];
    };
    assert.equal((await score("en")).getAttribute("aria-label"), "Smart score 65");
    assert.equal((await score("ja")).getAttribute("aria-label"), "頭よさそうスコア 65");
  });

  it("CardID未対応時の保存ボタン title は cardBannerShort（英語UIに日本語を残さない）", async () => {
    const en = await drive({ consent: true, localInit: init("en"), cardId: "{{CardID}}" });
    const ja = await drive({ consent: true, localInit: init("ja"), cardId: "{{CardID}}" });
    assert.equal(en.els["umeboshi-ask-save-btn"].title, text(en, "en").cardBannerShort);
    assert.equal(ja.els["umeboshi-ask-save-btn"].title, text(ja, "ja").cardBannerShort);
    assert.notEqual(text(en, "en").cardBannerShort, text(ja, "ja").cardBannerShort);
  });
});

// #131 saved-explanation heading (empty-question text + updated-at brackets) follows UI language.
// Key "presence" in the phrase table is not a check, so compare rendered row textContent ja vs en.
describe("#131 Threadタイトルを言語追従にする", () => {
  const init = (lang) => ({ "umeboshi-ask:settings:v1": JSON.stringify({ version: 1, sendMode: "button", lang }) });
  const UPD = "2026-10-03 12:34";

  // Server reply returns a question-blank Message. The empty-question save guard (threadEmptyQ)
  // applies to the send string, so pass non-empty to save and blank only the reply.
  const driveThread = async (lang, question = "") => {
    const h = await drive({
      consent: true,
      localInit: init(lang),
      onFetch: async (url, o) => {
        const r = await redeemOK()(url, o);
        if (r) return r;
        if (url.includes("/api/ask/threads/") && o?.method === "POST") {
          return resp(200, { message: { id: "m1", question, answer: "A.", updatedAt: UPD } });
        }
        return null;
      },
    });
    await h.redeem();
    h.sandbox.UmeboshiAskThread.save("?", "A.");
    await tick(12);
    const item = h.els["umeboshi-ask-thread-list"].children[0];
    const headBtn = item.children[0];
    return { h, headBtn, label: () => headBtn.children[1].textContent };
  };

  it("root.UmeboshiAskThreadTitle.head() も同じ文言を返す", async () => {
    const en = (await driveThread("en")).h.sandbox.UmeboshiAskThreadTitle.head;
    const ja = (await driveThread("ja")).h.sandbox.UmeboshiAskThreadTitle.head;
    assert.equal(en({ question: "", updatedAt: UPD }), "(no question) (" + UPD + ")");
    assert.equal(ja({ question: "", updatedAt: UPD }), "（質問なし）（" + UPD + "）");
    // Titled Messages stay independent of question and updatedAt, as before.
    assert.equal(en({ title: "生成題名", question: "Q?", updatedAt: UPD }), "生成題名");
  });

  it("threadNoQ は日英LOCALESに両方あり、キー差分 0 が保たれる", async () => {
    const h = await drive({});
    const ja = h.sandbox.UmeboshiAskI18n.uiText("ja");
    const en = h.sandbox.UmeboshiAskI18n.uiText("en");
    assert.equal(ja.threadNoQ, "（質問なし）");
    assert.equal(en.threadNoQ, "(no question)");
    assert.deepEqual(Object.keys(ja).sort(), Object.keys(en).sort());
  });
});

describe("S13 DoDピン（成果物・Worker契約）", () => {
  it("D1/D4/D10/D11/D16/D18：ビルド成果物に主要パターンが残る", () => {
    for (const p of [
      "umeboshi-ask-card-id", "{{CardID}}", "umeboshi-ask-cardid-banner",
      "umeboshi-ask:refresh:v1",
      "data-theme", "umeboshi-ask-export-btn",
    ]) assert.ok(BUILT_HTML.includes(p), "builtに " + p);
    // OS5b: consent button lives in the injected build with the module, not base artifacts (same
    // treatment as OS5a billing). Keep it out of base; pin it on the injected build.
    assert.ok(!BUILT_HTML.includes("umeboshi-ask-consent-agree"), "base の built に同意ボタンが戻っている");
    // OSS tree has no module, so the injected presence is host-only.
    // On host, keep seeing it on the injected build as before.
    if (HAS_MODULE) assert.ok(BUILT_HOST_HTML.includes("umeboshi-ask-consent-agree"), "注入版に同意ボタンが無い");
    // OS5c: add-on route body moved to the module side. Keep __umeboshiAddonStore out of base and
    // pin it on the injected build (REFRESH_KEY home itself stays in base).
    assert.ok(!BUILT_HTML.includes("__umeboshiAddonStore"), "base の built にログイン導線が戻っている");
    if (HAS_MODULE) assert.ok(BUILT_HOST_HTML.includes("__umeboshiAddonStore"), "注入版にログイン導線が無い");
  });
  // #86: removed price list, plan radios, upgrade-this-month-only, and theme from settings modal.
  // Prices live only on the purchase dashboard and Worker PLANS (ADR-0002, Q65 face values).
  // #160 folded the "view/buy/manage" trio into one "Manage subs & credits" entry.
  // OS5a (#261): this DoD pins the billing UI itself, so look at injected-build artifacts.
  // Base panel intentionally has zero billing elements (empty seam only).
  it("#160 クレジットタブは価格のGcTAを出さない。入口は1ボタンだけ", () => {
    // OSS tree has no billing UI body, so host-only.
    // On host, keep checking the injected billing DoD as before.
    if (!HAS_MODULE) return;
    const html = BUILT_HOST_HTML;
    for (const gone of [
      "umeboshi-ask-billing-plans", "umeboshi-ask-upgrade-target",
      "umeboshi-ask-upgrade-btn", "umeboshi-ask-upgrade-status",
      "/api/billing/plans", "今月だけアップグレード",
      "umeboshi-ask-buy-credits-btn", "umeboshi-ask-portal-btn",
      "umeboshi-ask-portal-fallback", "/api/billing/portal-session",
    ]) {
      assert.ok(!html.includes(gone), "カードに " + gone + " が戻っている");
    }
    for (const kept of ["umeboshi-ask-billing-btn", "umeboshi-ask-billing-login-hint", "umeboshi-ask-url-popup", "umeboshi-ask-url-input"]) {
      assert.ok(html.includes(kept), "カードに " + kept + " がない");
    }
    const doors = html.match(/<button[^>]*id="umeboshi-ask-billing-btn"/g) || [];
    assert.equal(doors.length, 1, "入口は1ボタンだけ");
    assert.match(html, /id="umeboshi-ask-billing-btn">サブスク・クレジットを管理</, "ラベルが新しい");
    assert.match(html, /id="umeboshi-ask-billing-login-hint">Google にログインしてください</, "匿名の誘導文言がない");
    assert.match(html, /#umeboshi-ask-billing-btn\[hidden\] \{ display: none; \}/, "匿名は display:none になる");
    assert.ok(!html.includes('data-title="テーマ"'), "テーマ設定が戻っている");
    assert.match(html, /data-tab="lang">言語</, "タブ名が「言語」ではない");
    assert.match(html, /github\.com\/Karimuto\/umeboshi-ask/, "MITリンクが死んでいる");
  });

  it("#14受入1〜2件目：runbookに3環境×7シナリオとDoD 18項目がある", () => {
    // OSS tree has no host runbook, so check it only when present.
    // On host, keep checking the DoD doc as before.
    if (!fs.existsSync(path.join(REPO, "docs/dod-v1.5.3.md"))) return;
    const dod = SRC("docs/dod-v1.5.3.md");
    for (const env of ["Desktop", "Droid", "Web"]) assert.ok(dod.includes(env));
    for (const s of ["初回→保存→再表示", "超過→誘導", "加入→解放", "中断→手動保存", "15秒切替", "Cloze", "ELI5"]) {
      assert.ok(dod.includes(s), s);
    }
    for (let n = 1; n <= 18; n++) assert.ok(dod.includes("D" + n));
  });

});

describe("人力検証FAIL回帰（2026-09-04報告）", () => {
  it("FAIL-A: ビルド成果物にAnkiが誤読する{{ }}リテラルが残らない", () => {
    const legit = ["{{CardID}}", "{{cloze:Text}}", "{{Text}}", "{{#Back Extra}}", "{{Back Extra}}", "{{/Back Extra}}"];
    let rest = BUILT_HTML;
    for (const l of legit) rest = rest.split(l).join("");
    assert.ok(!rest.includes("{{"), "Anki誤読の種が残る");
    assert.ok(!rest.includes("}}"), "Anki誤読の種が残る");
    const script = SCRIPT;
    assert.ok(!script.includes('indexOf("{{")'));
    assert.ok(!script.includes('indexOf("}}")'));
  });

  it("FAIL-B: モデル一覧が取得できればpopup選択肢に並ぶ（#47 非native）", async () => {
    const h = await drive({ consent: true, onFetch: async (url) => {
      if (url.endsWith("/api/ask/models")) {
        return resp(200, { models: [
          { id: "m-cheap", name: "Cheap", priceUsdPer1M: 0.1 },
          { id: "m-dear", name: "Dear", priceUsdPer1M: 2.5 },
        ] });
      }
      return null;
    }});
    const btn = h.els["umeboshi-ask-model"];
    const list = h.els["umeboshi-ask-model-list"];
    assert.equal(btn.disabled, false);
    assert.equal(list.children.length, 2);
    assert.match(h.els["umeboshi-ask-models-status"].textContent, /2件のモデルが利用可能/);
  });

  it("#47: モデルボタンで4段階が開き、詳細モデル選択の奥で選び直せる（#198）", async () => {
    const h = await drive({ consent: true, onFetch: async (url) => {
      if (url.endsWith("/api/ask/models")) {
        return resp(200, { models: [
          { id: "m-cheap", name: "Cheap", priceUsdPer1M: 0.1 },
          { id: "m-dear", name: "Dear", priceUsdPer1M: 2.5 },
        ] });
      }
      return null;
    }});
    const tier = h.els["umeboshi-ask-tier-popup"];
    const popup = h.els["umeboshi-ask-model-popup"];
    assert.equal(tier.hidden, true);
    h.els["umeboshi-ask-model"].click();
    await tick(4);
    assert.equal(tier.hidden, false);
    /* #198 with no presets the 4 tiers show empty text but keep the detail entry. */
    assert.equal(h.els["umeboshi-ask-tier-list"].children.length, 1);
    h.els["umeboshi-ask-tier-detail-btn"].click();
    await tick(4);
    assert.equal(tier.hidden, true);
    assert.equal(popup.hidden, false);
    assert.equal(h.els["umeboshi-ask-model-list"].children.length, 2);
    const first = h.els["umeboshi-ask-model-list"].children[0];
    assert.equal(first.className, "umeboshi-ask-model-row");
    const firstBtn = first.children[0];
    /* #198 rows are [tier] [(model)], so the model name is children[1]. */
    assert.equal(firstBtn.children[1].textContent, "(Cheap)");
    assert.equal(firstBtn.getAttribute("data-model-id"), "m-cheap");
    firstBtn.click();
    await tick(4);
    assert.equal(popup.hidden, true);
    assert.match(h.els["umeboshi-ask-model"].textContent, /Cheap/);
    h.els["umeboshi-ask-model"].click();
    await tick(4);
    h.els["umeboshi-ask-tier-detail-btn"].click();
    await tick(4);
    assert.equal(popup.hidden, false);
    h.els["umeboshi-ask-model-close"].click();
    await tick(4);
    assert.equal(popup.hidden, true);
  });

  it("#47: 会社名は出さず短名＋脳スコア・選択中にチェック行なし", async () => {
    const h = await drive({ consent: true, onFetch: async (url) => {
      if (url.endsWith("/api/ask/models")) {
        return resp(200, { models: [
          { id: "z-ai/glm-5.3-flash", name: "Z.ai: GLM 5.3 Flash", priceUsdPer1M: 0.15, smartScore: 65, credits: 1 },
          { id: "xiaomi/mimo-v2.5", name: "Xiaomi: MiMo-V2.5", priceUsdPer1M: 0.14, credits: 1 },
        ] });
      }
      return null;
    }});
    const rows = h.els["umeboshi-ask-model-list"].children;
    assert.equal(rows.length, 2);
    /* #198 rows are [tier(icon+text)] [(model)] [strength]. No presets in
       this reply, so all Custom. */
    const glm = rows[1].children[0];
    assert.equal(glm.children[0].children[0].textContent, "Custom");
    assert.equal(glm.children[1].textContent, "(GLM 5.3 Flash)");
    assert.equal(glm.children[2].getAttribute("aria-label"), "頭よさそうスコア 65");
    assert.equal(glm.children[2].children[0].textContent, "65");
    const mimo = rows[0].children[0];
    assert.equal(mimo.children.length, 2);
    assert.equal(mimo.children[0].children[0].textContent, "Custom");
    assert.equal(mimo.children[1].textContent, "(MiMo-V2.5)");
    for (const r of rows) {
      for (const c of r.children) assert.doesNotMatch(c.textContent || "", /✓|✅/);
    }
    assert.doesNotMatch(h.els["umeboshi-ask-model-list"].textContent || "", /✓/);
    assert.match(h.els["umeboshi-ask-model"].textContent, /MiMo-V2\.5/);
    assert.doesNotMatch(textOf(h.els["umeboshi-ask-model"]), /credits/, "#198 目安クレジットはモデルラベルに出さない");
    assert.doesNotMatch(textOf(h.els["umeboshi-ask-model"]), /Xiaomi: |Z\.ai: /);
  });

  it("#72: マイナススコアも🧠表示され0は出ない", async () => {
    const h = await drive({ consent: true, onFetch: async (url) => {
      if (url.endsWith("/api/ask/models")) {
        return resp(200, { models: [
          { id: "xiaomi/mimo-v2.5", name: "Xiaomi: MiMo-V2.5", priceUsdPer1M: 0.14, smartScore: -10, credits: 1 },
          { id: "z-ai/glm-5.3-flash", name: "Z.ai: GLM 5.3 Flash", priceUsdPer1M: 0.15, smartScore: 7, credits: 1 },
          { id: "xiaomi/mimo-v2.6-pro", name: "Xiaomi: MiMo-V2.6-Pro", priceUsdPer1M: 0.435, smartScore: 0, credits: 1 },
        ] });
      }
      return null;
    }});
    const rows = h.els["umeboshi-ask-model-list"].children;
    assert.equal(rows.length, 3);
    /* #198 rows are [tier(icon+text)] [(model)] [strength]. No presets, so all Custom. */
    const mimo = rows[0].children[0];
    assert.equal(mimo.children[2].getAttribute("aria-label"), "頭よさそうスコア -10");
    assert.equal(mimo.children[2].children[0].textContent, "-10");
    const glm = rows[1].children[0];
    assert.equal(glm.children[2].children[0].textContent, "7");
    const pro = rows[2].children[0];
    assert.equal(pro.children.length, 2);
    assert.equal(pro.children[1].textContent, "(MiMo-V2.6-Pro)");
  });

  /* #198 4-tier (ModelTier) per human decision: tier names Basic/Middle/Premium/Ultra,
     no credit hints, unwired tiers read "insufficient credits". */
  const init = (lang) => ({ "umeboshi-ask:settings:v1": JSON.stringify({ version: 1, sendMode: "button", lang }) });
  const TIER_MODELS = [
    { id: "xiaomi/mimo-v2.6-pro", name: "Xiaomi: MiMo-V2.6-Pro", priceUsdPer1M: 0.435, smartScore: 8, credits: 1, supportedEfforts: [], defaultEffort: null },
    { id: "google/gemini-3.8-flash", name: "Google: Gemini 3.8 Flash", priceUsdPer1M: 0.75, smartScore: 30, credits: 6, supportedEfforts: ["high", "medium", "low"], defaultEffort: "medium", scores: { high: 30, medium: 29, low: 21 } },
    { id: "anthropic/claude-opus-5.5", name: "Anthropic: Claude Opus 5.5", priceUsdPer1M: 4, smartScore: 46, credits: 31, supportedEfforts: ["max", "xhigh", "high", "medium", "low"], defaultEffort: "high", scores: { max: 46, xhigh: 43, high: 41, medium: 40, low: 39 } },
  ];
  const TIER_PRESETS = [
    { tier: "basic", modelId: "xiaomi/mimo-v2.6-pro", effort: null },
    { tier: "middle", modelId: "google/gemini-3.8-flash", effort: "medium" },
    { tier: "premium", modelId: "anthropic/claude-opus-5.5", effort: "high" },
    { tier: "ultra", modelId: "anthropic/claude-opus-5.5", effort: "max" },
  ];
  const driveTiers = async (lang = "ja", onUsage = null) => drive({
    consent: true,
    localInit: init(lang),
    onFetch: async (url) => {
      if (url.endsWith("/api/ask/models")) return resp(200, { models: TIER_MODELS, presets: TIER_PRESETS });
      if (url.endsWith("/api/usage") && onUsage) return onUsage();
      return null;
    },
  });

  it("#198: モデルボタンで4段階が開き、級名・モデル短名・強さだけが出る", async () => {
    const h = await driveTiers();
    await tick(12);
    h.els["umeboshi-ask-model"].click();
    await tick(4);
    assert.equal(h.els["umeboshi-ask-tier-popup"].hidden, false);
    const rows = h.els["umeboshi-ask-tier-list"].children;
    assert.equal(rows.length, 4);
    const want = [
      ["ベーシック", "(MiMo-V2.6-Pro)", "🧠", "8"],
      ["ミドル", "(Gemini 3.8 Flash: medium)", "🧠", "29"],
      ["プレミアム", "(Claude Opus 5.5: high)", "🧠", "41"],
      ["ウルトラ", "(Claude Opus 5.5: max)", "🧠", "46"],
    ];
    for (let i = 0; i < want.length; i++) {
      const b = rows[i];
      assert.equal(b.getAttribute("data-tier"), TIER_PRESETS[i].tier);
      // Children are [tier(icon+text)] [model side] [strength] [...balance]
      assert.equal(b.children[0].children[0].textContent, want[i][0], "級名");
      assert.equal(b.children[1].textContent, want[i][1], "モデル側");
      assert.equal(b.children[2].textContent, want[i][2], "強さの記号");
      assert.equal(b.children[2].children[0].textContent, want[i][3], "強さの数値");
      assert.doesNotMatch(textOf(b), /credits/, "#198 目安クレジットは出さない");
    }
  });

  it("#198: 段を押すと model＋effort の2鍵に入り、ラベルと押し場所が追従する", async () => {
    const h = await driveTiers();
    await tick(12);
    h.els["umeboshi-ask-model"].click();
    await tick(4);
    h.els["umeboshi-ask-tier-list"].children[3].click();
    await tick(4);
    assert.equal(h.els["umeboshi-ask-tier-popup"].hidden, true);
    assert.equal(h.local.getItem("umeboshi-ask:model:v1"), "anthropic/claude-opus-5.5");
    const efforts = JSON.parse(h.local.getItem("umeboshi-ask:effort:v1"));
    assert.equal(efforts["anthropic/claude-opus-5.5"], "max");
    assert.match(h.els["umeboshi-ask-model"].textContent, /Opus 5\.5/);
    assert.match(h.els["umeboshi-ask-model"].textContent, /Max/);
    h.els["umeboshi-ask-model"].click();
    await tick(4);
    const rows = h.els["umeboshi-ask-tier-list"].children;
    assert.equal(rows[3].getAttribute("aria-checked"), "true");
    assert.equal(rows[0].getAttribute("aria-checked"), "false");
  });

  it("#198: 詳細モデル選択は従来のモデル一覧を開き、4段階は閉じる", async () => {
    const h = await driveTiers();
    await tick(12);
    h.els["umeboshi-ask-model"].click();
    await tick(4);
    h.els["umeboshi-ask-tier-detail-btn"].click();
    await tick(4);
    assert.equal(h.els["umeboshi-ask-tier-popup"].hidden, true);
    assert.equal(h.els["umeboshi-ask-model-popup"].hidden, false);
    assert.equal(h.els["umeboshi-ask-model-sheet-title"].textContent, "モデル");
  });

  it("#198: Effort 別の強さを行に付け、未計測は `—` と読み上げを出す", async () => {
    const MODEL_WITH_GAP = [{
      id: "z-ai/glm-5.3-flash", name: "Z.ai: GLM 5.3 Flash", priceUsdPer1M: 0.15, smartScore: 7, credits: 1,
      supportedEfforts: ["max", "high", "low"], defaultEffort: "max", reasoningMandatory: true,
      scores: { max: 7 },
    }];
    const h = await drive({
      consent: true,
      localInit: init("ja"),
      onFetch: async (url) => (url.endsWith("/api/ask/models") ? resp(200, { models: MODEL_WITH_GAP }) : null),
    });
    await tick(12);
    h.els["umeboshi-ask-model"].click();
    await tick(4);
    h.els["umeboshi-ask-tier-detail-btn"].click();
    await tick(4);
    h.els["umeboshi-ask-model-list"].children[0].children[1].click();
    await tick(4);
    assert.equal(h.els["umeboshi-ask-effort-popup"].hidden, false);
    const rows = h.els["umeboshi-ask-effort-list"].children;
    assert.equal(rows.length, 3);
    assert.equal(textOf(rows[0]), "Max ✓🧠7");
    /* high/low unmeasured. Show `—` with "unmeasured" readout. */
    assert.equal(textOf(rows[1]), "High—");
    assert.equal(rows[1].children[0].getAttribute("aria-label"), "頭よさそうスコアは未計測");
    assert.equal(textOf(rows[2]), "Low—");
  });

  it("#198: 英語UIの4段階は Basic/Middle/Premium/Ultra、日本語が混ざらない", async () => {
    const h = await driveTiers("en");
    await tick(12);
    h.els["umeboshi-ask-model"].click();
    await tick(4);
    const rows = h.els["umeboshi-ask-tier-list"].children;
    assert.deepEqual(rows.map((r) => r.children[0].children[0].textContent), ["Basic", "Middle", "Premium", "Ultra"]);
    assert.equal(rows[0].children[1].textContent, "(MiMo-V2.6-Pro)");
    assert.equal(rows[1].children[1].textContent, "(Gemini 3.8 Flash: medium)");
    assert.equal(h.els["umeboshi-ask-tier-detail-btn"].textContent, "Detailed model choice");
    assert.equal(h.els["umeboshi-ask-tier-sheet-title"].textContent, "Choose by tier");
  });

  it("#198: モデル一覧の「4段階に戻る」で詳細から1タップで戻れる", async () => {
    const h = await driveTiers();
    await tick(12);
    h.els["umeboshi-ask-model"].click();
    await tick(4);
    h.els["umeboshi-ask-tier-detail-btn"].click();
    await tick(4);
    assert.equal(h.els["umeboshi-ask-model-popup"].hidden, false);
    assert.equal(h.els["umeboshi-ask-tier-popup"].hidden, true);
    const back = h.els["umeboshi-ask-model-back"];
    assert.equal(back.getAttribute("aria-label"), "4段階に戻る");
    back.click();
    await tick(4);
    assert.equal(h.els["umeboshi-ask-model-popup"].hidden, true);
    assert.equal(h.els["umeboshi-ask-tier-popup"].hidden, false);
    /* En UI switches only the readout (icons shared). */
    const en = await driveTiers("en");
    await tick(12);
    assert.equal(en.els["umeboshi-ask-model-back"].getAttribute("aria-label"), "Back to tiers");
  });

  it("#198: モデル一覧の行も級に追従し、4級外は Custom (tune)", async () => {
    const h = await driveTiers();
    await tick(12);
    h.els["umeboshi-ask-model"].click();
    await tick(4);
    h.els["umeboshi-ask-tier-detail-btn"].click();
    await tick(4);
    const rows = h.els["umeboshi-ask-model-list"].children;
    assert.equal(rows.length, 3);
    // Cheapest first: MiMo-V2.6-Pro(basic) / Gemini(middle) / Opus(premium=default high)
    const labels = rows.map((r) => [r.children[0].children[0].children[0].textContent, r.children[0].children[1].textContent]);
    assert.deepEqual(labels, [
      ["ベーシック", "(MiMo-V2.6-Pro)"],
      ["ミドル", "(Gemini 3.8 Flash)"],
      ["プレミアム", "(Claude Opus 5.5)"],
    ]);
    /* Opus sits in both premium(high) and ultra(max), so default high shows premium. */
    assert.equal(rows[2].children[0].getAttribute("data-tier"), "premium");
  });

  it("#198: Effort を変えるとモデル一覧の行の級も追従する（Opus max → ウルトラ）", async () => {
    const MODEL_WITH_GAP = [{
      id: "anthropic/claude-opus-5.5", name: "Anthropic: Claude Opus 5.5", priceUsdPer1M: 4, smartScore: 46, credits: 31,
      supportedEfforts: ["max", "high"], defaultEffort: "high", scores: { max: 46, high: 41 },
    }];
    const h = await drive({
      consent: true,
      localInit: init("ja"),
      onFetch: async (url) => (url.endsWith("/api/ask/models")
        ? resp(200, { models: MODEL_WITH_GAP, presets: TIER_PRESETS })
        : null),
    });
    await tick(12);
    h.els["umeboshi-ask-model"].click();
    await tick(4);
    h.els["umeboshi-ask-tier-detail-btn"].click();
    await tick(4);
    const rows = h.els["umeboshi-ask-model-list"].children;
    assert.equal(rows[0].children[0].children[0].children[0].textContent, "プレミアム");
    // Switch Effort to max -> row tier follows to Ultra
    h.els["umeboshi-ask-model-list"].children[0].children[1].click();
    await tick(4);
    assert.equal(h.els["umeboshi-ask-effort-popup"].hidden, false);
    h.els["umeboshi-ask-effort-list"].children[0].click();
    await tick(4);
    const after = h.els["umeboshi-ask-model-list"].children;
    assert.equal(after[0].children[0].children[0].children[0].textContent, "ウルトラ");
    assert.equal(after[0].children[0].children[1].textContent, "(Claude Opus 5.5)");
  });

  it("#198: ← は1つ上に戻り、✕ は学習画面に戻る（モーダルを全部閉じる）", async () => {
    const MODEL_WITH_GAP = [{
      id: "z-ai/glm-5.3-flash", name: "Z.ai: GLM 5.3 Flash", priceUsdPer1M: 0.15, smartScore: 7, credits: 1,
      supportedEfforts: ["max", "high"], defaultEffort: "max", scores: { max: 7 },
    }];
    const h = await drive({
      consent: true,
      localInit: init("ja"),
      onFetch: async (url) => (url.endsWith("/api/ask/models") ? resp(200, { models: MODEL_WITH_GAP }) : null),
    });
    await tick(12);
    h.els["umeboshi-ask-model"].click();
    await tick(4);
    h.els["umeboshi-ask-tier-detail-btn"].click();
    await tick(4);
    h.els["umeboshi-ask-model-list"].children[0].children[1].click();
    await tick(4);
    assert.equal(h.els["umeboshi-ask-effort-popup"].hidden, false);
    // Back arrow: closes Effort only, model list stays
    h.els["umeboshi-ask-effort-back"].click();
    await tick(4);
    assert.equal(h.els["umeboshi-ask-effort-popup"].hidden, true);
    assert.equal(h.els["umeboshi-ask-model-popup"].hidden, false);
    // X: closes both, back to study screen
    h.els["umeboshi-ask-model-list"].children[0].children[1].click();
    await tick(4);
    h.els["umeboshi-ask-effort-close"].click();
    await tick(4);
    assert.equal(h.els["umeboshi-ask-effort-popup"].hidden, true);
    assert.equal(h.els["umeboshi-ask-model-popup"].hidden, true);
    /* En UI switches only the readout. */
    const en = await drive({
      consent: true,
      localInit: init("en"),
      onFetch: async (url) => (url.endsWith("/api/ask/models") ? resp(200, { models: MODEL_WITH_GAP }) : null),
    });
    await tick(12);
    assert.equal(en.els["umeboshi-ask-effort-back"].getAttribute("aria-label"), "Back to models");
    assert.equal(en.els["umeboshi-ask-model-back"].getAttribute("aria-label"), "Back to tiers");
  });

  it("FAIL-C: 503でもエラー文面が表示され、回答欄ごと隠れない", async () => {
    const h = await drive({ consent: true, onFetch: async (url) => {
      if (url.endsWith("/api/ask/chat")) {
        const b = { error: "LLM not configured" };
        return { ok: false, status: 503, json: async () => b, text: async () => JSON.stringify(b) };
      }
      return null;
    }});
    await h.ask("why");
    await tick(12);
    assert.match(h.els["umeboshi-ask-stream-status"].textContent, /^エラー: /);
    assert.equal(h.els["umeboshi-ask-current"].hidden, false);
  });

  it("#88: 502のupstreamPreviewがカードに出るので、原因の推測只用で終わらない", async () => {
    const preview = "No allowed providers are available for the selected model.";
    const h = await drive({ consent: true, onFetch: async (url) => {
      if (url.endsWith("/api/ask/chat")) {
        const b = { error: "LLM upstream error", upstreamStatus: 404, upstreamPreview: preview };
        return { ok: false, status: 502, json: async () => b, text: async () => JSON.stringify(b) };
      }
      return null;
    }});
    await h.ask("why");
    await tick(12);
    const s = h.els["umeboshi-ask-stream-status"].textContent;
    assert.match(s, /^エラー: LLM upstream error/);
    assert.ok(s.includes(preview), "上流理由が載る: " + s);
  });
});

// #85 (2026-09-30 report): typing one kana char then ELI5 echoed it back.
// {question} now resolves only from the input box or template label,
// decided uniquely (send button alone is freeText).
describe("#85 テンプレボタンと送信ボタンの混線", () => {
  const chatOk = async (url) => {
    if (url.endsWith("/api/ask/chat")) return sseResp([sseLine({ type: "done" })]);
    return null;
  };
  const typedSettings = (prompts) => ({
    "umeboshi-ask:settings:v1": JSON.stringify({
      version: 1, sendMode: "button", lang: "auto",
      prompts, customs: [], efforts: {},
    }),
  });

  it("入力欄に「あ」があってもELI5は規定プロンプトを送る（入力欄を飲み込まない）", async () => {
    const h = await drive({ consent: true, rawText: "テスト本文", onFetch: chatOk });
    h.els["umeboshi-ask-input"].value = "あ";
    await h.ask("eli5");
    const q = h.chatBody().question;
    assert.ok(q.startsWith("「5歳にもわかるように」について"), q);
    assert.doesNotMatch(q, /「あ」/);
  });

  it("入力欄が空でも同じ文面（{question}がキー名eli5に落ちない）", async () => {
    const h = await drive({ consent: true, rawText: "テスト本文", onFetch: chatOk });
    await h.ask("eli5");
    const q = h.chatBody().question;
    assert.ok(q.startsWith("「5歳にもわかるように」について"), q);
    assert.doesNotMatch(q, /「eli5」/);
  });

  it("設定で書いたラベルが{question}に入る（ボタン面と同じ解決順）", async () => {
    const prompts = { eli5: { label: "MYLABEL", body: "Q={question}" } };
    const h = await drive({ consent: true, rawText: "テスト本文", onFetch: chatOk, localInit: typedSettings(prompts) });
    h.els["umeboshi-ask-input"].value = "あ";
    await h.ask("eli5");
    assert.equal(h.chatBody().question, "Q=MYLABEL");
    const btn = h.els["umeboshi-ask-buttons"].children.find((c) => c.getAttribute("data-ask") === "eli5");
    assert.equal(btn.textContent, "MYLABEL");
  });

  it("英語UIなら{question}はELI5（UI言語に追随する）", async () => {
    const prompts = { eli5: { label: "", body: "Q={question}" } };
    const settings = { ...typedSettings(prompts) };
    settings["umeboshi-ask:settings:v1"] = JSON.stringify({
      version: 1, sendMode: "button", lang: "en",
      prompts, customs: [], efforts: {},
    });
    const h = await drive({ consent: true, rawText: "body", onFetch: chatOk, localInit: settings });
    h.els["umeboshi-ask-input"].value = "あ";
    await h.ask("eli5");
    assert.equal(h.chatBody().question, "Q=ELI5");
  });

  it("送信ボタンは入力欄の文章を{question}にする（テンプレを直しても潰れない）", async () => {
    const h = await drive({ consent: true, rawText: "テスト本文", onFetch: chatOk });
    h.els["umeboshi-ask-input"].value = "あ";
    h.els["umeboshi-ask-send-btn"].click();
    await tick(12);
    assert.ok(h.chatBody().question.startsWith("「あ」について"), h.chatBody().question);
  });

});

// #94: Worker cut at max_tokens streams error(code:"truncated"), not done.
// Card shows a UI-language message on the error row, never the code name.
describe("#94 max_tokens切れをエラーとして見せる", () => {
  // Finite stream (sseStreamResp stays open until abort, so this differs).
  const sseEndResp = (lines) => {
    let i = 0;
    const enc = (t) => new TextEncoder().encode(t);
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => lines.join("\n"),
      body: {
        getReader: () => ({
          read: () => Promise.resolve(
            i < lines.length ? { done: false, value: enc(lines[i++] + "\n\n") } : { done: true },
          ),
          cancel: () => {},
        }),
      },
    };
  };
  // lines are already sseLine() raw lines. Do not JSON-encode twice.
  const chatWith = (lines) => async (url) =>
    (url.endsWith("/api/ask/chat") ? sseEndResp(lines) : null);
  const TRUNCATED = [sseLine({ type: "content", delta: "答えは…" }),
    sseLine({ type: "error", code: "truncated", maxTokens: 8192 })];
  const statusOf = (h) => h.els["umeboshi-ask-stream-status"].textContent;

  it("日本語UIではコード名ではなく日本語の警告をエラー行に出す", async () => {
    const h = await drive({ consent: true, onFetch: chatWith(TRUNCATED) });
    await h.ask("why");
    await tick(12);
    assert.match(statusOf(h), /^エラー: /);
    assert.match(statusOf(h), /途中で切れました/);
    assert.doesNotMatch(statusOf(h), /truncated/);
  });

  it("英語UIでは同じ code を英語で出す", async () => {
    const h = await drive({
      consent: true,
      onFetch: chatWith(TRUNCATED),
      localInit: {
        "umeboshi-ask:settings:v1": JSON.stringify({
          version: 1, sendMode: "button", lang: "en", prompts: {}, customs: [], efforts: {},
        }),
      },
    });
    await h.ask("why");
    await tick(12);
    assert.match(statusOf(h), /^Error: /);
    assert.match(statusOf(h), /output limit/);
  });

  it("truncated以外の error は従来どおり message をそのまま出す", async () => {
    const h = await drive({
      consent: true,
      onFetch: chatWith([sseLine({ type: "error", code: "stream_error", message: "Stream interrupted" })]),
    });
    await h.ask("why");
    await tick(12);
    assert.match(statusOf(h), /^エラー: Stream interrupted$/);
  });

  it("切れた回答は自動保存もメッセージ化もしない（done と同じ扱いにしない）", async () => {
    const h = await drive({ consent: true, onFetch: chatWith(TRUNCATED) });
    await h.ask("why");
    await tick(12);
    assert.equal(h.els["umeboshi-ask-messages"].children.length, 0);
    assert.equal(h.threadsPosts().length, 0);
  });
});

// #94 fingerprint for the "same happens on low" answer side.
// Measured (15 direct OpenRouter hits): effort=low still yields reasoning 178-696/8192, finish=stop, body present.
// So blank frames on low have a different cause than max_tokens. Worker returns
// error(empty_answer) for zero body beyond length. Card shows ja/en text, not the code name.
describe("#94 空回答をエラーとして見せる", () => {
  const sseEndResp = (lines) => {
    let i = 0;
    const enc = (t) => new TextEncoder().encode(t);
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => lines.join("\n"),
      body: {
        getReader: () => ({
          read: () => Promise.resolve(
            i < lines.length ? { done: false, value: enc(lines[i++] + "\n\n") } : { done: true },
          ),
          cancel: () => {},
        }),
      },
    };
  };
  const chatWith = (lines) => async (url) =>
    (url.endsWith("/api/ask/chat") ? sseEndResp(lines) : null);
  const EMPTY = [
    sseLine({ type: "thinking", delta: "考え中…" }),
    sseLine({ type: "error", code: "empty_answer", finishReason: "stop" }),
  ];
  const statusOf = (h) => h.els["umeboshi-ask-stream-status"].textContent;

  it("日本語UIではコード名ではなく日本語の文言をエラー行に出す", async () => {
    const h = await drive({ consent: true, onFetch: chatWith(EMPTY) });
    await h.ask("why");
    await tick(12);
    assert.match(statusOf(h), /^エラー: /);
    assert.match(statusOf(h), /回答が空でした/);
    assert.doesNotMatch(statusOf(h), /empty_answer/);
  });

  it("英語UIでは同じ code を英語で出す", async () => {
    const h = await drive({
      consent: true,
      onFetch: chatWith(EMPTY),
      localInit: {
        "umeboshi-ask:settings:v1": JSON.stringify({
          version: 1, sendMode: "button", lang: "en", prompts: {}, customs: [], efforts: {},
        }),
      },
    });
    await h.ask("why");
    await tick(12);
    assert.match(statusOf(h), /^Error: /);
    assert.match(statusOf(h), /came back empty/);
  });

  it("空回答は切り詰め警告と文面が別（両方を混ぜない）", async () => {
    const h = await drive({ consent: true, onFetch: chatWith(EMPTY) });
    await h.ask("why");
    await tick(12);
    assert.doesNotMatch(statusOf(h), /途中で切れました/);
  });

  // #94: the point. Staying done leaves only "question-only empty tile + Save" (= screenshot).
  it("空回答はメッセージ化しない（空枠だけのタイルを残さない）", async () => {
    const h = await drive({ consent: true, onFetch: chatWith(EMPTY) });
    await h.ask("why");
    await tick(12);
    assert.equal(h.els["umeboshi-ask-messages"].children.length, 0);
    assert.equal(h.threadsPosts().length, 0);
  });

  // #94: staying done piles up thinking and leaves an empty frame (measured fingerprint). Error keeps partial display.
  it("空回答でもストリーム領域は表示されたまま（閉じない）", async () => {
    const h = await drive({ consent: true, onFetch: chatWith(EMPTY) });
    await h.ask("why");
    await tick(12);
    assert.equal(h.els["umeboshi-ask-current"].hidden, false);
  });
});

describe('#172 AF3 spent line', () => {
  const sseEndResp = (lines) => {
    let i = 0;
    const enc = (t) => new TextEncoder().encode(t);
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => lines.join("\n"),
      body: {
        getReader: () => ({
          read: () => Promise.resolve(
            i < lines.length ? { done: false, value: enc(lines[i++] + "\n\n") } : { done: true },
          ),
          cancel: () => {},
        }),
      },
    };
  };
  const chatWith = (lines) => async (url) =>
    (url.endsWith("/api/ask/chat") ? sseEndResp(lines) : null);
  const DONE6 = [sseLine({ type: "content", delta: "x" }), sseLine({ type: "done", messageId: "m1", charged: 6 })];
  const DONEBARE = [sseLine({ type: "content", delta: "x" }), sseLine({ type: "done", messageId: "m1" })];
  const TRUNC = [sseLine({ type: "content", delta: "x" }), sseLine({ type: "error", code: "truncated", maxTokens: 8192 })];
  const TRUNC6 = [sseLine({ type: "content", delta: "x" }), sseLine({ type: "error", code: "truncated", maxTokens: 8192, charged: 6 })];
  const TRUNCBARE = [sseLine({ type: "content", delta: "x" }), sseLine({ type: "error", code: "truncated", maxTokens: 8192 })];
  const statusOf = (h) => h.els["umeboshi-ask-stream-status"].textContent;
  it('bare done shows nothing', async () => {
    const h = await drive({ consent: true, onFetch: chatWith(DONEBARE) });
    await h.ask("why");
    await tick(12);
    assert.equal(statusOf(h), "");
  });
  it('truncated shows error not spent', async () => {
    const h = await drive({ consent: true, onFetch: chatWith(TRUNC) });
    await h.ask("why");
    await tick(12);
    assert.match(statusOf(h), /^\u30a8\u30e9\u30fc: /);
  });
  it('truncated without settled cost shows error only', async () => {
    const h = await drive({ consent: true, onFetch: chatWith(TRUNCBARE) });
    await h.ask("why");
    await tick(12);
    assert.doesNotMatch(statusOf(h), /credits/);
  });
});

// #134 mechanically pin "no Japanese left in en UI" as green/red.
// #125's measured hole was "translated but unwired" 24 keys. Key-diff tests stayed green
// and waved it through (key present != wired). So pin it in two gates.
//   Gate 1: read built HTML as string, extract all Japanese text nodes, and judge by
//            "element rewritable by applyLang" or allowlist.
//   Gate 2: assert textContent per element under en UI.
describe("#134 英語UIに日本語を残さないゲート", () => {
  const init = (lang) => ({ "umeboshi-ask:settings:v1": JSON.stringify({ version: 1, sendMode: "button", lang }) });
  // Kana/kanji/halfwidth katakana. Used to detect UI-language leaks.
  const KANA_KANJI = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/;
  // Japanese marks (commas, brackets, corner quotes). #130/#132 squashed leaks per phrasing.
  const JP_PUNCT = /[・（）「」]/;

  /* ---------- Gate 1: structural scan of built HTML ---------- */

  // Proper nouns/technical terms stay untranslated. Allowed even inside Japanese text.
  const ALLOW_WORDS = [
    "Anki", "AnkiDroid", "Anki Desktop", "AnkiWeb", "CardID", "Effort", "Thread",
    "Message", "Worker", "OpenRouter", "Google", "localStorage", "navigator",
    "Refresh", "Access", "Send", "POST /api/ask/chat", "JST", "MIT License",
    "Karimuto/umeboshi-ask",
    // Language names stay Japanese even in en UI by spec (never "Japanese").
    "日本語", "English",
  ];
  // 3 kinds excluded from scan (#125 §4). All server-controlled or user input; card owns no translation duty.
  //   - Model names from OpenRouter / user-written prompt bodies (injected at runtime)
  //   - Consent dialog body (renderConsent redraws per language. Allow both ja/en)
  const ALLOW_CONTAINERS = [
    "umeboshi-ask-consent-body",
    "umeboshi-ask-model-list", "umeboshi-ask-effort-list",
    "umeboshi-ask-prompt-list", "umeboshi-ask-custom-list",
  ];
  const VOID_TAGS = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
  ]);

  // Pull Japanese text nodes with their ancestor (self-inclusive) id chain.
  // Strip script/style first: code, not on-screen copy. FakeEl selectors
  // do not accept scans, so read HTML as a string.
  function japaneseTextNodes(html) {
    const src = html
      .replace(/<script\b[\s\S]*?<\/script>/gi, "<script></script>")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "<style></style>");
    const out = [];
    const stack = [];
    const re = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)([^>]*)>|([^<]+)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (m[4] !== undefined) {
        const text = m[4].trim();
        if (text !== "" && KANA_KANJI.test(text)) {
          out.push({ text, ids: stack.filter((e) => e.id !== "").map((e) => e.id) });
        }
        continue;
      }
      const closing = m[1];
      const tag = m[2];
      const attrs = m[3];
      const name = tag.toLowerCase();
      if (closing === "/") {
        for (let i = stack.length - 1; i >= 0; i -= 1) {
          if (stack[i].tag === name) { stack.length = i; break; }
        }
        continue;
      }
      const id = (/\bid\s*=\s*["']([^"']+)["']/.exec(attrs) || [])[1] || "";
      stack.push({ tag: name, id });
      if (VOID_TAGS.has(name)) stack.pop();
    }
    return out;
  }

  // True when kana/kanji remain after removing allowlist words.
  // No remainder means proper-nouns-only copy: allowed. Remainder requires wiring.
  // Skipping early on "contains allowlist word" stays green even unwired
  // (saved-explanation Thread case). That repeats the exact #125-measured hole:
  // the check misses the "unwired" state.
  function japaneseOutsideAllowlist(text) {
    let rest = text;
    for (const w of ALLOW_WORDS) rest = rest.split(w).join(" ");
    return KANA_KANJI.test(rest);
  }

  // Return leaked Japanese as "owner: text" array. Empty array is green.
  // Order matters: container exclusion -> wired -> proper-nouns-only, in that order.
  // "Has an id-bearing ancestor" alone stays green and waves through (#umeboshi-ask ancestors all nodes).
  function leakedJapanese(html, script) {
    const red = [];
    for (const n of japaneseTextNodes(html)) {
      if (n.ids.some((id) => ALLOW_CONTAINERS.includes(id))) continue;
      const owner = n.ids[n.ids.length - 1] || "";
      if (owner !== "" && script.includes('"' + owner + '"')) continue;
      if (!japaneseOutsideAllowlist(n.text)) continue;
      red.push((owner || "(id無し)") + ": " + JSON.stringify(n.text.slice(0, 40)));
    }
    return red;
  }

  it("ゲート1: 静的HTMLの日本語は全て「配線を持ちうるid」か「許可リスト文言」に入る", () => {
    const nodes = japaneseTextNodes(BUILT_HTML);
    // OS5c: static Japanese for the login route moved to the module. base floor is 33.
    assert.ok(nodes.length >= 30, "走査対象が少なすぎる（" + nodes.length + "件）");
    assert.deepEqual(leakedJapanese(BUILT_HTML, SCRIPT), [],
      "英語UIに日本語のまま残る文言");
    // Pin injected static Japanese as the host-side floor.
    // OSS tree has no module, so host-only.
    // On host, keep checking the injected build as before.
    if (HAS_MODULE) {
      const hostNodes = japaneseTextNodes(BUILT_HOST_HTML);
      assert.ok(hostNodes.length >= 40, "注入版の走査対象が少なすぎる（" + hostNodes.length + "件）");
      assert.deepEqual(leakedJapanese(BUILT_HOST_HTML, HOST_SCRIPT), [],
        "注入版の英語UIに日本語のまま残る文言");
    }
  });

  it("ゲート1の判定関数自体は「未配線の日本語」で赤になる（穴の証明）", () => {
    // A check that stays green proves nothing. A naive "has an id" rule can never
    // turn red because #umeboshi-ask ancestors every node. So feed the same judge
    // HTML that "has an id but is never read by script", prove it turns red first,
    // then keep the whole green.
    const html = '<div id="umeboshi-ask"><div id="umeboshi-ask-title-x">未配線の見出し</div></div>';
    const wired = 'byId("umeboshi-ask-title-x").textContent = t.titleX;';
    assert.deepEqual(leakedJapanese(html, wired), [], "配線があれば緑");
    assert.deepEqual(leakedJapanese(html, ""), ['umeboshi-ask-title-x: "未配線の見出し"'],
      "配線を外すと赤になる");
    // Pin as regression: an ancestor-id-only rule cannot catch it.
    assert.ok(html.includes("id=\"umeboshi-ask\""), "検査対象の仮HTMLに祖先のidがある");
  });

  it("ゲート1: 許可リスト語を含む文言でも、配線を外せば赤になる", () => {
    // Skipping early on "contains allowlist word" stays green even unwired.
    // Measured: removing wiring for "saved Thread" in umeboshi-ask-thread-title stayed green.
    // So the allowlist only excuses proper-nouns-only copy.
    const html = '<div id="umeboshi-ask"><div id="umeboshi-ask-thread-title">保存済みThread</div></div>';
    const wired = 'byId("umeboshi-ask-thread-title").textContent = t.threadTitle;';
    assert.deepEqual(leakedJapanese(html, wired), [], "配線があれば緑（許可リスト語を含んでいても）");
    assert.deepEqual(leakedJapanese(html, ""), ['umeboshi-ask-thread-title: "保存済みThread"'],
      "許可リスト語を含んでいても、配線を外せば赤になる");
    // Proper-nouns-only copy is allowed without wiring (the allowlist's real job).
    assert.deepEqual(
      leakedJapanese('<div id="umeboshi-ask"><span>Anki 25.09.2+ / AnkiDroid</span></div>', ""),
      [], "許可リスト語だけの文言は緑のまま");
  });

  /* ---------- Gate 2: per-element assertions under en UI ---------- */

  it("③ 英語UI: 送信モードと言語のラジオラベルが英訳されている", async () => {
    const en = await drive({ localInit: init("en") });
    const T = en.sandbox.UmeboshiAskI18n.uiText("en");
    const LABELS = {
      "umeboshi-ask-sendmode-button": "sendModeButton",
      "umeboshi-ask-sendmode-enter": "sendModeEnter",
      "umeboshi-ask-lang-radio-auto": "langAuto",
      // Language names stay untranslated even in en UI by spec. Same as gate-1 allowlist.
      "umeboshi-ask-lang-radio-ja": "langJa",
      "umeboshi-ask-lang-radio-en": "langEn",
    };
    for (const [id, key] of Object.entries(LABELS)) {
      assert.equal(en.els[id].textContent, T[key], "英語UIの " + id + " が " + key + " と違う");
    }
    // Only one language name stays Japanese. Other labels leaking is a leak.
    const leaky = ["umeboshi-ask-sendmode-button", "umeboshi-ask-sendmode-enter",
      "umeboshi-ask-lang-radio-auto", "umeboshi-ask-lang-radio-en"]
      .filter((id) => KANA_KANJI.test(en.els[id].textContent));
    assert.deepEqual(leaky, [], "英語UIで日本語のまま出るラジオラベル");
  });

  it("⑦ 英語UI: モデルラベルに `credits/問` が出ない", async () => {
    const MODELS = [{
      id: "m-cheap", name: "Cheap", priceUsdPer1M: 0.1, smartScore: 65, credits: 30,
      supportedEfforts: ["low", "high"], defaultEffort: "high",
    }];
    const run = async (lang) => {
      const h = await drive({
        consent: true,
        localInit: init(lang),
        onFetch: async (url) => (url.endsWith("/api/ask/models") ? resp(200, { models: MODELS }) : null),
      });
      await tick(12);
      return h.els["umeboshi-ask-model"].textContent;
    };
    assert.equal(await run("en"), "Cheap 🧠65 (High)");
    assert.equal(await run("ja"), "Cheap 🧠65（High）");
    const en = await run("en");
    assert.doesNotMatch(en, /credits\/問/, "英語UIのモデルラベルに `credits/問` が出る");
    assert.doesNotMatch(en, KANA_KANJI, "英語UIのモデルラベルに日本語が残っている");
  });

  it("⑧ ja / en のキー差分が 0", async () => {
    const h = await drive({});
    const ja = h.sandbox.UmeboshiAskI18n.uiText("ja");
    const en = h.sandbox.UmeboshiAskI18n.uiText("en");
    assert.deepEqual(Object.keys(ja).sort(), Object.keys(en).sort());
  });

  it("⑨ 言語を切り替えてもドリルイン復元が効く（itemKey が不変）", async () => {
    // .umeboshi-ask-item-title is the applyLang-rewritten display. data-title is the
    // itemKey() stable key, frozen in Japanese. Same key across the switch restores it.
    const item = fakeItem("リセット");
    const head = new FakeEl("");
    head.className = "umeboshi-ask-item-title";
    head.textContent = "Reset";
    item.appendChild(head);
    item.querySelector = (sel) => (sel === ".umeboshi-ask-item-title" ? head : null);
    const panel = fakePanel("general", [item]);
    const h = await drive({ localInit: init("en"), panels: [panel] });

    panel.menu.children[0].click();
    assert.equal(h.els["umeboshi-ask-detailbar"].hidden, false, "英語UIで行をタップすると詳細が開く");
    assert.equal(h.els["umeboshi-ask-detail-title"].textContent, "Reset", "英語UIの行の見出し");
    const keyBefore = item.getAttribute("data-title");

    // Drop language to ja. Full settings reset re-calls applyLang + buildAllMenus + reopenDetail.
    head.textContent = "リセット";
    h.els["umeboshi-ask-reset-all"].click();
    await tick(12);

    assert.equal(h.sandbox.UmeboshiAskSettings.load().lang, "auto", "言語は自動判定へ戻る");
    assert.equal(h.els["umeboshi-ask-lang-status"].textContent, "表示言語: ja（取得元: navigator）");
    assert.equal(item.getAttribute("data-title"), keyBefore, "言語を切り替えても itemKey（data-title）が変わらない");
    // Same key restores the detail; only the heading takes the new language.
    assert.equal(h.els["umeboshi-ask-detailbar"].hidden, false, "言語切替後も詳細が開いたまま（復元された）");
    assert.equal(h.els["umeboshi-ask-detail-title"].textContent, "リセット", "復元後の見出しはUI言語に追従する");
    assert.equal(panel.menu.children[0].children[0].textContent, "リセット", "行の見出しもUI言語に追従する");
  });
/* ---------- Gate 3: card-JS Japanese-literal scan ---------- */

  // Phrase tables and default prompts are "copy itself", so excluded. OS5b moved consent text
  // (consentParagraphs) to the private module, out of base script.
  // Only inline literals in logic remain.
  // This gate catches the leftover "bare Japanese fallback" from #125.
  function scriptOutsideConstants() {
    const body = panelScript();
    const from = body.indexOf("var LOCALES = {");
    const at = body.indexOf("/* umeboshi-ask:module:script begin */");
    assert.ok(from >= 0 && at > from, "文言表の位置を探せる");
    return body.slice(0, from) + body.slice(body.indexOf("\n", at));
  }

  // Allow bare Japanese in exactly 1 place. Document a reason per addition.
  const ALLOW_JA = [
    ["プロンプト prompt ", "searchHay の検索語。日英を併記する仕様"],
    ["「{question}」について、カード文脈を踏まえて答えてください。", "カスタム質問の既定本文。英語枝と対"],
    ["あと", "formatCountdown の日本語枝。直上に英語枝がある"],
    ["日", "同上"],
    ["時間", "同上"],
    ["分", "同上"],
    ["（このカード）: ", "buildClozeInfo。LLM に送るテキストで #125 のスコープ外"],
    ["「{question}」について説明してください。", "defaultComposeFallback の日本語枝。直上に英語枝がある"],
  ];

  it("⑩ カードJSに素の和文リテラルが増えていない", () => {
    const js = scriptOutsideConstants();
    const found = [];
    const LIT = /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g;
    let m;
    while ((m = LIT.exec(js)) !== null) {
      if (!KANA_KANJI.test(m[1])) continue;
      const value = m[1].slice(1, -1);
      if (ALLOW_JA.some(([p]) => value.startsWith(p))) continue;
      const line = js.slice(0, m.index).split("\n").length;
      found.push(line + "行目: " + value.slice(0, 60));
    }
    assert.deepEqual(found, [], "素の和文は LOCALES に置く。gate1/2 では拾えない");
  });
});
