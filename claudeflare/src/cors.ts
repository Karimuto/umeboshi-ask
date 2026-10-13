// PRD §6: CORS. S1 is read-only, but allow X-Anon-Id from S4 on early to
// avoid CORS breakage. D5: x-card-id required.
// D16 edits/deletes (PATCH/DELETE) join methods so preflight never blocks them.
//
// #100 hole 1: `Access-Control-Allow-Origin: origin ?? "*"` used to echo any
// request Origin back. Then any web page could read this Worker's JSON (model
// list, quota, login URL) through the browser. Define an allowlist and send no
// ACAO for off-list Origins.
//
// Five allowed entries:
//   1. `null` … Anki Desktop (QtWebEngine) runs in a file:// WebView, so the
//      Origin is null.
//   2. `https://ankiweb.net` … AnkiWeb itself (first party. Kept as insurance. #209).
//   3. `https://ankiuser.net` … AnkiWeb card-isolation domain (#209 grill).
//      Card JS runs from here. Observed: console CORS complaints name
//      `from origin 'https://ankiuser.net'` four times, and `location.origin`
//      matches (`self === top`, so not an iframe). The
//      `frame-ancestors https://ankiweb.net` CSP is the official isolation claim.
//   4. Loopback origins (http://127.0.0.1:PORT and http://localhost:PORT).
//      **AnkiDroid/AnkiMobile serve the reviewer from a local HTTP server**, so
//      card Origins look like `http://127.0.0.1:<random port>`
//      (ankidroid/Anki-Android#14737 logcat shows
//      `http://127.0.0.1:37995/assets/reviewer_extras_bundle.js`).
//      Ports change per session, so never match on the number. Cutting here
//      makes **every** AnkiDroid card unreadable.
//   5. The request's own origin (same origin). Same-origin page requests pass
//      through here; the browser sends Origin and same-origin is allowed.
// Origin-less calls (curl / AnkiConnect / Stripe webhooks) are outside a
// browser context, so pass them without ACAO (browsers cannot read them).
//
// Why no 403:
// This API never auths by Cookie. Auth is `Authorization: Bearer` headers only,
// and `Access-Control-Allow-Credentials` is never sent. So CSRF (attaching
// credentials automatically from another origin) cannot hold; CORS guards only
// "reading the response". No ACAO = browser never reads it = complete defense.
// "Reject off-list with 403" is possible, but Anki WebViews may return unknown
// Origins and break login itself. Answer, but unreadable — that is the behavior.
// Future: once `site/` fixes its domain, add it here explicitly.
// Headers the hosted build allows. Core (OSS) has no billing webhook, so it
// uses ALLOW_HEADERS_CORE (no Stripe-Signature) (#264 OS4b).
const ALLOW_HEADERS = "Content-Type, Authorization, x-card-id, X-Anon-Id, Stripe-Signature";
const ALLOW_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";
// #264 OS4b: headers core (OSS) allows. No billing webhook, so no
// Stripe-Signature. The hosted build keeps the default ALLOW_HEADERS above.
export const ALLOW_HEADERS_CORE = "Content-Type, Authorization, x-card-id, X-Anon-Id";

/** AnkiWeb itself (first-party domain. Kept as insurance). Allowed in #209. */
export const ALLOWED_ORIGIN_ANKIWEB = "https://ankiweb.net";

/** AnkiWeb card-isolation domain. Card JS runs from here. Allowed in #209 grill. */
export const ALLOWED_ORIGIN_ANKIUSER = "https://ankiuser.net";

/** Origin a file:// Anki WebView sends. */
export const ALLOWED_ORIGIN_NULL = "null";

/**
 * Whether the request Origin is on the allowlist.
 * Origin-less calls (non-browser) return true.
 * The check lives only here; corsHeadersFor and preflight share it.
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
 * Whether the origin is loopback. AnkiDroid/AnkiMobile serve the reviewer from
 * a local HTTP server, so card fetches always pass here. Ports change per
 * session, so match on hostname only.
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
  // Attach ACAO only for allowlisted Origins. Origin-less calls need no ACAO.
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
