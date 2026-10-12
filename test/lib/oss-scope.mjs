// #266 OS6b: OSS tree の境界定義。ガード (test/oss-boundary.test.mjs) と
// 組み立て (OS6c) が同じ定義を読むための置き場。
//
// OS6c は OSS tree を組み立てるとき、この IN_SCOPE / OUT_OF_SCOPE の二分を
// そのまま使うこと。keyword を足すときは KEYWORDS を直し、日常語の pin は
// ガード側 (ALLOWED_EVERYDAY_WORDS) と同時に直す。片方だけ直すと赤になる。

// 課金語。実装語だけを載せる。日常語 (plan・usage・model 等) は載せない。
// size は小文字で探す (Stripe は Stripe-Signature 等の固有名も拾うため)。
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

// 語ごとの選定理由。keyword を足す・削るときはここも直す。
// billing・Stripe・checkout・subscription・topup・promo: 課金の機構語。
// どれも日常の面板・Worker の語彙には現れない (日常語は別 pin で固定)。
// credits: モデル価格の受取 (`m.credits` の読取) は許す。property access を
// 走査から外すので、残る `credits` は課金の額面だけになる (詳細は下の注)。
// クレジット・価格・料金・請求・残高: 課金の和文語。base の和文に現れない。
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

// 除外理由つき許容。ガードが走査の前に外すもの。
// 1. `.credits` の property access (`m.credits` 等): Worker が送る価格字段の
// 受取であり、課金概念の導入ではない。base は `m.credits == null` を選択可
// として扱う (OS4b の前提)。コード層から `\.[A-Za-z_$][\w$]*` を外す。
// 実装は property 名ごとではなく access 丸ごとに外す。`m.credits` の `m`
// が残っても日常語なので誤爆しないし、`.` の後ろを残すより穴が小さい。
// 2. `kind === "billing"` の kind 文字列: popup 文面の種別子であり、base に
// billing 文面が無いことは別 pin (base に課金トークンが無いこと) で見る。
// 文字列の中身は走査しないので、ここでは外す理由を書くだけ。
// 3. OSS 側 root テストと test/lib の語彙: host との差分を述べる言及であり、
// 実装の導入ではない。走査対象外とし、テスト自体の導入は keyword snapshot で pin。
// 4. models.ts の `credits` 定義: bundle の予約額の正であり、コア応答には
// 載せない ((b) の `delete bare.credits` が pin)。OSS tree に置く公開単価の
// 目安であり、課金機構の導入ではない。keyword 走査では `credits` の語だけ
// models.ts から外し、他の課金語が混ざったら赤になる形にする。
export const ALLOW_NOTES = Object.freeze([
  "`.credits` の property access は Worker の価格字段の受取なので外す",
  "`kind === \"billing\"` の kind 文字列は文面の種別子。文字列の中身は走査しない",
  "OSS 側 root テスト内の語彙は走査対象外。host との差分を述べる言及であり、実装の導入ではない",
  "models.ts の `credits` 定義は bundle の予約額の正。(b) の落としと組で pin し、他の課金語は走査する",
]);

// worker のコア到達集合。core.ts の静的 import の推移閉包。
// ratelimit・anon を core.ts が import しないことが OS4b の前提。
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

// 評価する OSS 側 root テスト。OSS tree 内でも緑になるものだけ。
// addon-package・anki-note-types・archive-shadowing・note-types-freshness・
// ja-en-parity・setup-min は host 専用物（PUBLISH/CHECKLIST・fixture・git 履歴・
// site）を参照するので host 側へ移した（OS6c の実測）。
export const OSS_ROOT_TESTS = Object.freeze([
  "test/s13-dod.test.mjs",
  "test/os2c-selfhost.test.mjs",
  "test/panel-module.test.mjs",
  "test/panel-version.test.mjs",
  "test/thread-head-typography.test.mjs",
]);

// host 側 root テスト。評価しない。
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

// 含める: 追跡ファイルだけを評価する (`git ls-files`)。
// worker は CORE_REACHABLE の推移閉包、test は OSS_ROOT_TESTS だけ。
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

// 除く理由。ガードが対象外を数えるときの説明用。
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
