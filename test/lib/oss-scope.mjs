// #266 OS6b: OSS-tree boundary definition. Shared home for the guard
// (test/oss-boundary.test.mjs) and the assembly (OS6c) to read one definition.
//
// OS6c must reuse this inScope/outReason split when assembling the OSS tree.
// When adding a keyword, edit KEYWORDS and the guard-side everyday-word pin
// together. Editing only one side fails.

// Billing terms. Implementation words only; no everyday words (plan, usage, model, ...).
// Match case-insensitively (Stripe also catches Stripe-Signature proper nouns).
export const KEYWORDS = Object.freeze([
  { word: "billing", pattern: /\bbilling\b/gi, why: "code" },
  { word: "Stripe", pattern: /\bstripe\b/gi, why: "code" },
  { word: "checkout", pattern: /\bcheckout\b/gi, why: "code" },
  { word: "credits", pattern: /\bcredits\b/gi, why: "code" },
  { word: "subscription", pattern: /\bsubscription\b/gi, why: "code" },
  { word: "topup", pattern: /\btopup\b/gi, why: "code" },
  { word: "promo", pattern: /\bpromo\b/gi, why: "code" },
  { word: "クレジット", pattern: /クレジット/g, why: "code" },
  { word: "価格", pattern: /価格/g, why: "code" },
  { word: "料金", pattern: /料金/g, why: "code" },
  { word: "請求", pattern: /請求/g, why: "code" },
  { word: "残高", pattern: /残高/g, why: "code" },
]);

// Per-term selection reasons. Update here when adding/removing keywords.
// billing, Stripe, checkout, subscription, topup, promo: billing machinery terms.
// None appear in everyday panel/Worker vocabulary (everyday words pinned separately).
// credits: receiving the model price (`m.credits` read) is allowed. Property
// access is stripped from the scan, so remaining `credits` is only billed amounts (note below).
// The Japanese billing terms (see KEYWORDS). Never appear in base Japanese copy.
export const KEYWORD_NOTES = Object.freeze({
  billing: "billing route・billing module の機構語",
  Stripe: "Stripe SDK・webhook の機構語",
  checkout: "Stripe Checkout の機構語",
  credits: "予約額の額面。`m.credits` の読取は property access として外す",
  subscription: "購読契約の機構語",
  topup: "単発購入の機構語",
  promo: "promo code の機構語",
  クレジット: "課金の和文語",
  価格: "課金の和文語",
  料金: "課金の和文語",
  請求: "課金の和文語",
  残高: "課金の和文語",
});

// Allowed with documented reasons. Stripped before the guard scans.
// 1. `.credits` property access (`m.credits` etc.): receives the price field
// sent by the Worker, not a billing-concept introduction. Base treats
// `m.credits == null` as selectable (OS4b premise). Strip `\.[A-Za-z_$][\w$]*`
// from the code layer. Strip the whole access, not per property name: a
// leftover `m` from `m.credits` is an everyday word and cannot misfire,
// and it leaves a smaller hole than keeping the name after `.`.
// 2. `kind === "billing"` kind strings: popup-copy kind labels, and the
// absence of billing copy in base is pinned separately (no billing tokens in base).
// String contents are never scanned; the reason is only recorded here.
// 3. OSS-side root tests and test/lib vocabulary: mentions describing the
// host diff, not implementation. Unscanned; their own terms are pinned by keyword snapshot.
// 4. models.ts `credits` definition: the legit bundle reservation, never in
// the core response (pinned by (b) `delete bare.credits`). A public unit-price
// guide for the OSS tree, not billing machinery. The keyword scan excludes
// only `credits` from models.ts so any other billing term still fails.
export const ALLOW_NOTES = Object.freeze([
  "`.credits` の property access は Worker の価格字段の受取なので外す",
  "`kind === \"billing\"` の kind 文字列は文面の種別子。文字列の中身は走査しない",
  "OSS 側 root テスト内の語彙は走査対象外。host との差分を述べる言及であり、実装の導入ではない",
  "models.ts の `credits` 定義は bundle の予約額の正。(b) の落としと組で pin し、他の課金語は走査する",
]);

// Worker core reachability set. Transitive closure of core.ts static imports.
// OS4b premise: core.ts must not import ratelimit or anon.
export const CORE_REACHABLE = Object.freeze([
  "chat.ts",
  "core.ts",
  "cors.ts",
  "identity.ts",
  "models.ts",
  "panel.ts",
  "secret.ts",
  "settings.ts",
  "stores.ts",
  "threads.ts",
]);

// OSS-side root tests under evaluation. Only ones green inside the OSS tree.
// addon-package, anki-note-types, archive-shadowing, note-types-freshness,
// ja-en-parity, setup-min are host-only (they touch PUBLISH/CHECKLIST,
// fixtures, git history, site), so they moved host-side (measured in OS6c).
export const OSS_ROOT_TESTS = Object.freeze([
  "test/s13-dod.test.mjs",
  "test/os2c-selfhost.test.mjs",
  "test/panel-module.test.mjs",
  "test/panel-version.test.mjs",
  "test/thread-head-typography.test.mjs",
]);

// Host-side root tests. Not evaluated.
export const HOST_ROOT_TESTS = Object.freeze([
  "test/um4-compat.test.mjs",
  "test/panel-login-dod.test.mjs",
  "test/auth-addon.test.mjs",
  "test/rate-limit-429.test.mjs",
  "test/addon-bridge.test.mjs",
  "test/md-render.test.mjs",
  "test/panel-billing-dod.test.mjs",
  "test/panel-consent-dod.test.mjs",
  "test/interrupt-thinking.test.mjs",
  "test/privacy-canonical.test.mjs",
  "test/promo-40.test.mjs",
  "test/promo-secret.test.mjs",
  "test/bformula-current.test.mjs",
  "test/context-glossary.test.mjs",
  "test/doc-refs.test.mjs",
  "test/site-claims.test.mjs",
  "test/site-frame.test.mjs",
  "test/tokutei-canonical.test.mjs",
  "test/license-claims.test.mjs",
  "test/worker-auth-split.test.mjs",
  "test/worker-cron.test.mjs",
  "test/worker-source-dod.test.mjs",
  "test/anki-css-injection.test.mjs",
  "test/ja-en-parity.test.mjs",
  "test/addon-package.test.mjs",
  "test/anki-note-types.test.mjs",
  "test/archive-shadowing.test.mjs",
  "test/note-types-freshness.test.mjs",
  "test/setup-min.test.mjs",
]);

// Inclusions: evaluate tracked files only (`git ls-files`).
// Worker files are the CORE_REACHABLE closure; tests only OSS_ROOT_TESTS.
export function inScope(path) {
  if (path === "package.json") return true;
  if (path === "build") return true;
  if (path === "addon/config.json") return true;
  if (path === "claudeflare/wrangler.core.toml") return true;
  if (path === "addon/templates/inject.html") return true;
  if (path === "src/components/askScaffold.ejs") return true;
  if (path === "src/components/askRenderer.ejs") return true;
  if (/^addon\/[^/]+\.(py|mjs|json)$/.test(path)) return true;
  if (CORE_REACHABLE.some((m) => path === `claudeflare/src/${m}`)) return true;
  if (
    CORE_REACHABLE.length === 10 &&
    /^claudeflare\/test\/core\/[^/]+\.test\.ts$/.test(path)
  ) {
    return true;
  }
  if (OSS_ROOT_TESTS.includes(path)) return true;
  if (path === "test/lib/panel-script.mjs") return true;
  if (path === "test/oss-boundary.test.mjs") return true;
  if (path === "test/lib/oss-scope.mjs") return true;
  if (path === "oss/assemble.mjs") return true;
  if (path === "oss/CONTRIBUTING.md") return true;
  if (path === "oss/CODEOWNERS") return true;
  if (path === "oss/SECURITY.md") return true;
  if (/^oss\/ISSUE_TEMPLATE\/[^/]+\.md$/.test(path)) return true;
  if (path === "claudeflare/package.json") return true;
  if (path === "claudeflare/tsconfig.json") return true;
  return false;
}

// Exclusion reasons. Labels for the guard's out-of-scope counts.
export function outReason(path) {
  if (path === "src/commercial/panel-module.js") return "commercial";
  if (path.startsWith("src/commercial/")) return "commercial";
  if (path === "claudeflare/test/full/") return "host-test";
  if (path.startsWith("claudeflare/test/full/")) return "host-test";
  if (HOST_ROOT_TESTS.includes(path)) return "host-test";
  if (path.startsWith("test/fixtures/")) return "host-fixture";
  if (path.startsWith("claudeflare/test/fixtures/")) return "host-fixture";
  if (path === "Note Types/") return "host-fixture";
  if (path.startsWith("Note Types/")) return "host-fixture";
  if (/\.ankiaddon$/.test(path)) return "binary";
  if (/\.(png|jpg|jpeg|webp|ico)$/i.test(path)) return "image";
  if (path.startsWith("docs/")) return "docs";
  if (path.startsWith("site/")) return "site";
  if (path.startsWith("marketing/")) return "marketing";
  if (path.startsWith("promo/")) return "marketing";
  if (path.startsWith("prototypes/")) return "prototype";
  if (path.startsWith("issueHarness/")) return "harness";
  if (path.startsWith("scripts/")) return "scripts";
  if (path.startsWith("oldArchitectureReference/")) return "reference";
  if (path === "invite-codes.txt") return "secret";
  if (path === ".github/workflows/harness.yml") return "harness-ci";
  if (path === ".github/workflows/harness-cron.yml") return "harness-ci";
  if (path === "CONTEXT.md") return "host-config";
  if (path === "DESIGN.md") return "host-config";
  if (path === "AGENTS.md") return "host-config";
  if (path === "README.md") return "host-config";
  if (path === "claudeflare/src/index.ts") return "host-worker";
  if (path === "claudeflare/src/auth.ts") return "host-worker";
  if (path === "claudeflare/src/billing.ts") return "host-worker";
  if (path === "claudeflare/src/billing-view.ts") return "host-worker";
  if (path === "claudeflare/src/anon.ts") return "host-worker";
  if (path === "claudeflare/src/settle.ts") return "host-worker";
  if (path === "claudeflare/src/usage.ts") return "host-worker";
  if (path === "claudeflare/src/reconcile.ts") return "host-worker";
  if (path === "claudeflare/src/ratelimit.ts") return "host-worker";
  if (path === "claudeflare/wrangler.toml") return "host-worker";
  if (path.startsWith("claudeflare/test/helpers/stripe-")) return "host-worker";
  return null;
}
