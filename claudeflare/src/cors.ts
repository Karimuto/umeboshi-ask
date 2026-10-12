// PRD §6: CORS。S1は読取専用だがS4以降のX-Anon-Idも先に許可して
// CORS起因の破壊を避ける。D5: x-card-id必須。
// D16の編集・削除（PATCH/DELETE）がpreflightで弾かれないようmethodsにも追加。
//
// #100 穴1: 以前は `Access-Control-Allow-Origin: origin ?? "*"` で
// リクエストのOriginを無条件に反転返していた。すると任意のWebページから
// このWorkerのJSON（モデル一覧・残量・login URLなど）をブラウザ経由で
// 読み取れた。許可リストを定義し、リスト外のOriginにはACAOを出さない。
//
// 許可するのは次の5つ。
//   1. `null` … Anki Desktop（QtWebEngine）はfile://のWebViewで走るため
//      Originがnull。
//   2. `https://ankiweb.net` … AnkiWeb本体（第一者。保険として残す。#209）。
//   3. `https://ankiuser.net` … AnkiWebのカード隔離ドメイン（#209 grill）。
//      カードJSはここから走る。実測: console の CORS 苦情文が
//      `from origin 'https://ankiuser.net'` と4回明記し、
//      `location.origin` も一致（`self === top` でiframeではない）。
//      `frame-ancestors https://ankiweb.net` のCSPが公式の隔離宣言。
//   4. ループバックorigin（http://127.0.0.1:PORT と http://localhost:PORT）。
//      **AnkiDroid/AnkiMobile は reviewer をローカルHTTPサーバで配信する**ので
//      カードのOriginは `http://127.0.0.1:<ランダムポート>` になる
//      （ankidroid/Anki-Android#14737 の logcat が
//      `http://127.0.0.1:37995/assets/reviewer_extras_bundle.js` を示している）。
//      ポートはセッションごとに変わるので数値では判定できない。
//      ここで切ると AnkiDroid のカードが**全部**読めなくなる。
//   5. リクエスト自身のorigin（同一origin）。
//      Worker自身が `/billing` を配信しており、そのページからのPOSTでは
//      ブラウザがOriginを送る。同一originなのでここを通してよい。
// Originヘッダ無しの呼び出し（curl / AnkiConnect / Stripeのwebhook）は
// ブラウザの文脈ではないのでACAOを付けずに通す（ブラウザは読めない）。
//
// なぜ403を返さないのか:
// このAPIはCookieで認証しない。認証は `Authorization: Bearer` ヘッダだけで、
// `Access-Control-Allow-Credentials` はどこにも出していない。よってCSRF
// （別オリジンから自動で資格情報を付けさせる攻撃）は成立しえず、CORSが
// 守るのは「応答の読み取り」だけ。ACAOを出さない＝ブラウザに読ませない＝
// それが完全な防御になる。
// 「許可リスト外は403で拒否」という手もあるが、AnkiのWebViewが未知の
// Originを返す可能性を含んでおり、loginごと壊す危険がある。応答は返す
// が読めない、という挙動を採る。
// 将来: `site/` がドメインを確定したら、ここへ明示的に追加する。
// 完全版が許可するヘッダー。コア（OSS 版）は課金 webhook が無いので
// ALLOW_HEADERS_CORE（Stripe-Signature 無し）を使う（#264 OS4b）。
const ALLOW_HEADERS = "Content-Type, Authorization, x-card-id, X-Anon-Id, Stripe-Signature";
const ALLOW_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";

// #264 OS4b: コア（OSS 版）が許可するヘッダー。課金 webhook の署名ヘッダー
// (Stripe-Signature) はコアに route が無いので載せない。課金を載せる完全版は
// 既定の ALLOW_HEADERS を使う（挙動は変えない）。
export const ALLOW_HEADERS_CORE = "Content-Type, Authorization, x-card-id, X-Anon-Id";

/** AnkiWeb本体（第一者ドメイン。保険として残す）。#209 で許可。 */
export const ALLOWED_ORIGIN_ANKIWEB = "https://ankiweb.net";

/** AnkiWebのカード隔離ドメイン。カードJSはここから走る。#209 grill で許可。 */
export const ALLOWED_ORIGIN_ANKIUSER = "https://ankiuser.net";

/** Ankiのfile:// WebViewが送るOrigin。 */
export const ALLOWED_ORIGIN_NULL = "null";

/**
 * リクエストのOriginが許可リストに含まれるか。
 * Originヘッダ無し（ブラウザ以外の呼び出し）はtrueを返す。
 * 許可判定の実体はここ1か所にあり、corsHeadersForとpreflightが共有する。
 */
export function isOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (origin === null) return true;
  if (origin === ALLOWED_ORIGIN_NULL) return true;
  if (origin === ALLOWED_ORIGIN_ANKIWEB) return true;
  if (origin === ALLOWED_ORIGIN_ANKIUSER) return true;
  if (isLoopbackOrigin(origin)) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/**
 * ループバックoriginかどうか。AnkiDroid/AnkiMobile は reviewer を
 * ローカルHTTPサーバで配信するので、カードからのfetchは必ずここを通る。
 * ポートはセッションごとに変わるため、ホスト名だけで判定する。
 */
export function isLoopbackOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return url.hostname === "127.0.0.1" || url.hostname === "localhost";
}

export function corsHeadersFor(request: Request, allowHeaders: string = ALLOW_HEADERS): Record<string, string> {
  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Max-Age": "86400",
  };
  // 許可リストのときだけACAOを付ける。Origin無しの呼び出しはACAO不要。
  if (origin !== null && isOriginAllowed(request)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function withCors(request: Request, response: Response, allowHeaders: string = ALLOW_HEADERS): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeadersFor(request, allowHeaders))) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
