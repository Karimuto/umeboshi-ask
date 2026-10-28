import { describe, it } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { panelScript } from "./lib/panel-script.mjs";

// Card-context switch (panel half): one checkbox by Send/buttons, default ON.
// ON sends today's composed question with card context and no signal key
// (old-panel compatible). OFF sends the display question verbatim with zero
// context chars, no images, and includeCardContext:false.
// English test names/comments (CONTRIBUTING).

const SCRIPT = panelScript();

const IDS = [
  "umeboshi-ask",
  "umeboshi-ask-send-btn", "umeboshi-ask-save-btn", "umeboshi-ask-cardid-banner",
  "umeboshi-ask-storage-banner",
  "umeboshi-ask-consent-modal", "umeboshi-ask-settings-modal", "umeboshi-ask-models-status",
  "umeboshi-ask-input", "umeboshi-ask-send-hint", "umeboshi-ask-settings-body",
  "umeboshi-ask-ankidroid-kb-hint",
  "umeboshi-ask-settings-tabs", "umeboshi-ask-settings-search", "umeboshi-ask-search-hint",
  "umeboshi-ask-detailbar", "umeboshi-ask-detail-back", "umeboshi-ask-detail-src",
  "umeboshi-ask-detail-title", "umeboshi-ask-results",
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
  "umeboshi-ask-settings-btn", "umeboshi-ask-settings-close", "umeboshi-ask-prompt-list",
  "umeboshi-ask-custom-list", "umeboshi-ask-current", "umeboshi-ask-thinking",
  "umeboshi-ask-thinking-body", "umeboshi-ask-answer", "umeboshi-ask-stream-status",
  "umeboshi-ask-stream-q",
  "umeboshi-ask-thread", "umeboshi-ask-thread-list", "umeboshi-ask-thread-status",
  "umeboshi-ask-messages", "umeboshi-ask-input-row", "umeboshi-ask-drawer",
  "umeboshi-ask-search-clear", "umeboshi-ask-lang-status",
  "umeboshi-ask-reset-all", "umeboshi-ask-reset-prompts",
  "umeboshi-ask-sendmode-button", "umeboshi-ask-sendmode-enter",
  "umeboshi-ask-cardctx", "umeboshi-ask-cardctx-label",
  "umeboshi-ask-title-sendmode", "umeboshi-ask-title-consent", "umeboshi-ask-title-reset",
  "umeboshi-ask-title-lang", "umeboshi-ask-title-account", "umeboshi-ask-title-migrate",
  "umeboshi-ask-title-credit", "umeboshi-ask-title-billing",
  "umeboshi-ask-title-workerurl", "umeboshi-ask-title-workertoken",
  "umeboshi-ask-worker-url", "umeboshi-ask-worker-url-note",
  "umeboshi-ask-worker-token", "umeboshi-ask-worker-token-note",
  "umeboshi-ask-lang-radio-auto", "umeboshi-ask-lang-radio-ja", "umeboshi-ask-lang-radio-en",
  "umeboshi-ask-consent-state", "umeboshi-ask-account-state",
  "umeboshi-ask-prompts-note", "umeboshi-ask-billing-note",
  "umeboshi-ask-consent-status",
  "umeboshi-ask-age-check", "umeboshi-ask-age-check-label", "umeboshi-ask-withdraw-note",
  "umeboshi-ask-consent-agree", "umeboshi-ask-consent-later", "umeboshi-ask-consent-withdraw",
  "umeboshi-ask-consent-title", "umeboshi-ask-consent-body",
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
  contains(el) { return (this.children || []).indexOf(el) >= 0; }
  querySelectorAll() { return []; }
  scrollIntoView() {}
  get classList() {
    return { add: () => {}, remove: () => {}, contains: () => false };
  }
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
const sseResp = (lines) => ({
  ok: true, status: 200,
  text: async () => lines.join("\n"), json: async () => ({}),
});
const tick = async (n = 8) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

const RAW = "CARDCTX-raw-text-marker";
const EXTRA = "CARDCTX-extra-marker";
const DATAURL = "data:image/png;base64,iVBORw0KGgo=";
const fakeImg = (src) => ({ getAttribute: (k) => (k === "src" ? src : null) });

async function drive(opts = {}) {
  const {
    rawText = RAW, extra = EXTRA, onFetch = null, localInit = {},
    lang = null, cardImgs = [],
  } = opts;
  const seed = { ...localInit };
  if (lang && !("umeboshi-ask:settings:v1" in seed)) {
    seed["umeboshi-ask:settings:v1"] = JSON.stringify({ version: 1, sendMode: "button", lang, prompts: {}, customs: [], efforts: {} });
  }
  const els = {};
  for (const id of IDS) els[id] = new FakeEl(id);
  els["umeboshi-ask-card-id"].textContent = "1234567890123";
  els["umeboshi-ask-consent-modal"].hidden = true;
  els["umeboshi-ask-settings-modal"].hidden = true;
  els["umeboshi-ask-model-popup"].hidden = true;
  els["umeboshi-ask-effort-popup"].hidden = true;
  els["umeboshi-ask-tier-popup"].hidden = true;
  // The static HTML carries the switch pre-checked; the fake DOM is built by
  // hand, so seed the same initial state the markup declares.
  els["umeboshi-ask-cardctx"].checked = true;
  els["raw-text"].textContent = rawText;
  els["text"].textContent = rawText;
  els["extra"].textContent = extra;
  const local = makeMemory(seed);
  // Persistence probe: every device-side write lands here. The switch must
  // never store anything (no key mentioning it may appear).
  const storedKeys = [];
  const rawSet = local.setItem;
  local.setItem = (k, v) => { storedKeys.push(String(k)); return rawSet(k, v); };
  const calls = [];
  const defaultFetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/api/ask/models")) return resp(200, { models: [] });
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
    querySelectorAll: (sel) => {
      if (typeof sel === "string" && sel.includes("#umeboshi-ask-buttons") && sel.includes("data-ask")) {
        const box = els["umeboshi-ask-buttons"];
        const customOnly = sel.includes("data-ask-custom");
        return (box?.children || []).filter((c) => customOnly
          ? c.getAttribute("data-ask-custom")
          : c.getAttribute("data-ask"));
      }
      if (sel === "img") return cardImgs;
      return [];
    },
    querySelector: () => null,
    addEventListener: () => {},
    body: { className: "" },
    _cookie: "",
    get cookie() { return this._cookie; },
    set cookie(v) { this._cookie = String(v); },
  };
  const sandbox = {
    console, Promise, JSON, Date, Math, Object, Array, String, Number, Boolean,
    RegExp, Error, setTimeout, clearTimeout, TextDecoder, AbortController,
    Uint8Array, ArrayBuffer, btoa,
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
  vm.runInContext(SCRIPT, sandbox, { filename: "askScaffold.js" });
  await tick(12);
  return {
    sandbox, els, local, calls, storedKeys,
    chatCalls: () => calls.filter((c) => c.url.endsWith("/api/ask/chat")),
    chatBody: () => {
      const c = calls.filter((x) => x.url.endsWith("/api/ask/chat")).at(-1);
      return c ? JSON.parse(c.init.body) : null;
    },
    ctxBox() { return els["umeboshi-ask-cardctx"] || doc.getElementById("umeboshi-ask-cardctx"); },
    async ask(key) {
      const box = els["umeboshi-ask-buttons"];
      const btn = box.children.find((c) => c.getAttribute("data-ask") === key);
      assert.ok(btn, "static button " + key);
      for (const fn of box._ls["click"] || []) fn.call(box, { target: btn });
      await tick(12);
    },
  };
}

const chatOk = async (url) => {
  if (url.endsWith("/api/ask/chat")) return sseResp([sseLine({ type: "done" })]);
  return null;
};

function setOff(h, off) {
  const box = h.ctxBox();
  assert.ok(box, "ctx switch exists");
  box.checked = off;
  for (const fn of box._ls["change"] || []) fn.call(box, { target: box });
}

describe("panel card-context switch", () => {
  it("ON (default): composed question carries card context and no signal key", async () => {
    const h = await drive({ onFetch: chatOk });
    assert.equal(h.ctxBox().checked, true, "switch starts ON");
    await h.ask("why");
    assert.equal(h.chatCalls().length, 1);
    const b = h.chatBody();
    assert.ok(b.question.includes(RAW), "card context is composed in");
    assert.ok(!("includeCardContext" in b), "ON sends no signal (old-panel compatible)");
  });

  it("OFF: display question verbatim, zero context chars, signal false", async () => {
    const h = await drive({ onFetch: chatOk });
    setOff(h, false);
    assert.equal(h.ctxBox().checked, false);
    h.els["umeboshi-ask-input"].value = "hello world";
    h.els["umeboshi-ask-send-btn"].click();
    await tick(12);
    assert.equal(h.chatCalls().length, 1);
    const b = h.chatBody();
    assert.equal(b.question, "hello world");
    assert.ok(!b.question.includes(RAW), "no text context leaks");
    assert.ok(!b.question.includes(EXTRA), "no extra context leaks");
    assert.equal(b.includeCardContext, false);
  });

  it("OFF skips images: no chatBody.images key", async () => {
    const h = await drive({ onFetch: chatOk, cardImgs: [fakeImg(DATAURL)] });
    setOff(h, false);
    h.els["umeboshi-ask-input"].value = "hello world";
    h.els["umeboshi-ask-send-btn"].click();
    await tick(12);
    assert.equal(h.chatCalls().length, 1);
    const b = h.chatBody();
    assert.equal(b.question, "hello world");
    assert.ok(!("images" in b), "OFF sends bare text only");
    assert.equal(b.includeCardContext, false);
  });

  it("OFF + question button: sends the button label verbatim", async () => {
    for (const key of ["why", "what", "significance", "origin", "eli5"]) {
      const h = await drive({ onFetch: chatOk });
      setOff(h, false);
      await h.ask(key);
      const b = h.chatBody();
      assert.equal(b.question, h.els["umeboshi-ask-buttons"].children
        .find((c) => c.getAttribute("data-ask") === key).textContent,
        `OFF ${key} sends its label verbatim`);
      assert.ok(!b.question.includes(RAW));
      assert.ok(!b.question.includes(EXTRA));
      assert.equal(b.includeCardContext, false);
    }
  });

  it("empty question is blocked in both modes", async () => {
    for (const off of [false, true]) {
      const h = await drive({ onFetch: chatOk });
      if (off) setOff(h, false);
      h.els["umeboshi-ask-input"].value = "   ";
      h.els["umeboshi-ask-send-btn"].click();
      await tick(12);
      assert.equal(h.chatCalls().length, 0, off ? "OFF empty blocked" : "ON empty blocked");
    }
  });

  it("card turn and close reset to ON (no persistence)", async () => {
    const h = await drive({ onFetch: chatOk });
    setOff(h, false);
    assert.equal(h.ctxBox().checked, false);
    h.sandbox.UmeboshiAskThread.load();
    await tick(12);
    assert.equal(h.ctxBox().checked, true, "load (card turn/close seam) resets to ON");
    // No persistence: nothing about the switch reaches device or worker storage.
    assert.ok(h.storedKeys.every((k) => !/ctx/i.test(k)), "device stored a ctx key: " + h.storedKeys);
    for (const c of h.calls) {
      if (c.init && typeof c.init.body === "string") {
        assert.ok(!c.init.body.includes("cardctx"), "no worker trace");
      }
    }
  });

  it("label switches ja/en, no tooltip", async () => {
    const ja = await drive({ onFetch: chatOk });
    assert.equal(ja.els["umeboshi-ask-cardctx-label"].textContent, "カードの問題を添付");
    assert.equal(ja.ctxBox().title || "", "", "no tooltip");
    const en = await drive({ onFetch: chatOk, lang: "en" });
    assert.equal(en.els["umeboshi-ask-cardctx-label"].textContent, "Attach card problem");
    assert.equal(en.ctxBox().title || "", "", "no tooltip");
  });
});
