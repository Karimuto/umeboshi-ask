# umeboshi-ask (OSS)

日本語版: [README.ja.md](README.ja.md)

Self-hosted study helper for Anki.
A Cloudflare Worker core, an Anki panel, and an Anki add-on in one package.

License: MIT. The hosted service (login, billing, sync) is not in this repo.

## What you get

- `claudeflare/src/core.ts`: the Worker core (no billing, no login routes).
- `src/components/askScaffold.ejs`: the panel source (`npm run build` renders it).
- `addon/`: the Anki add-on (Python, injection only).

## Setup (2 steps)

You need 1 secret: an OpenRouter API key. No login is needed.

### 1. Start the Worker (local)

```sh
cd claudeflare
cat > wrangler.oss-local.toml <<'EOF'
name = "umeboshi-ask-oss-local"
main = "src/core.ts"
compatibility_date = "2024-09-23"
# Keep this date as-is. It pins the Workers runtime the core was built for.
[[kv_namespaces]]
binding = "UMEBOSHI_KV"
id = "oss-local-kv"

[vars]
OPENROUTER_API_KEY = "<your-key>"
ASK_TOKEN = "<your-value>"
EOF
npx wrangler dev --config wrangler.oss-local.toml --port 8799
```

`wrangler.oss-local.toml` is yours. Do not commit it.
`ASK_TOKEN` is optional. It is only needed to save (threads, settings).

Without `[[kv_namespaces]]`, chat and models still work.
Threads and settings fail, and the panel falls back to local settings.

### 2. Point the panel at your Worker

Open the panel settings and paste 2 values:

- Worker URL = `http://127.0.0.1:8799`
- Access token = the same value as `ASK_TOKEN`

The keys the panel stores:

- `umeboshi-ask:worker-url:v1`
- `umeboshi-ask:worker-token:v1`

Then check the round-trip:

1. Ask a question. A streaming answer comes back.
2. Save (threads POST), rebuild the panel, and check threads GET shows it again.
3. Change the token to a wrong value and ask.
   A 401 shows the "check the access token in settings" guide.

## Scripts

- `npm run build`: render the panel (`addon/templates/inject.html`).
- `npm run build:addon`: pack the `.ankiaddon` (run `build` first).
- `npm test`: root tests (`node --test`).
- `npm run test:core`: Worker core tests (`claudeflare/test/core`).

## Boundary

The boundary guard (`test/oss-boundary.test.mjs`) keeps billing words out of
this tree. Do not bring billing words here (billing, Stripe, checkout,
credits as a balance, subscription, topup, promo, and their Japanese forms).
The per-model price field the Worker sends (`m.credits`) is received, not
introduced, and stays out of the scan as a property access.

## Troubleshooting

- 401: check the access token
  in the panel settings.
  It must match `ASK_TOKEN`.
- Save fails: without `[[kv_namespaces]]`,
  threads and settings cannot persist.
  The panel falls back to local settings.
- Chat returns 503:
  `OPENROUTER_API_KEY` is not set.
- Browser blocks the call: check CORS.
  The core answers known origins only
  (Anki Desktop, AnkiWeb, loopback
  for AnkiDroid, and same origin).

## Hosted version

A hosted version exists
for those who do not want to self-host.
The only differences are login,
payment, and sync.
This repo has none of those.
See https://umeboshi-ask.pages.dev/
for the hosted version.
