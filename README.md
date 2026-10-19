# umeboshi-ask (OSS)

日本語版: [README.ja.md](README.ja.md)

Self-hosted study helper for Anki, with a Cloudflare Worker core, an Anki panel,
and an Anki add-on in one package.

License: MIT.

## Requirements

- Node.js 24 LTS with npm and Git.
- Wrangler 3.x (3.114.17 works with this project).
- Anki Desktop 25.09.2 or later to try the add-on in Anki.
- A Cloudflare account, only when you deploy. Local runs and tests do not need one.

## What you get

- `claudeflare/src/core.ts`: the Worker core (no billing, no login routes).
- `src/components/askScaffold.ejs`: the panel source (`npm run build` renders it).
- `addon/`: the Anki add-on (Python, injection only).

## Setup (3 steps)

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
`ASK_TOKEN` is optional and only needed to save (threads, settings).

Without `[[kv_namespaces]]`, chat and models still work, but threads and
settings fail, so the panel falls back to local settings.


### 2. Add the panel to Anki

1. Run `npm run build` and `npm run build:addon`. The package is
   `umeboshi-ask-companion.ankiaddon` in the repository root.
2. In Anki, open Tools > Add-ons > Install from File, select the package, and restart Anki.
3. Open Tools > Add-ons and choose `umeboshi-ask: Inject ask`. Select a note type
   and press Apply. For details, see
   [CONTRIBUTING.md](CONTRIBUTING.md#check-panel-and-add-on-behavior-in-anki).

### 3. Point the panel at your Worker

Open the panel settings and paste 2 values:

- Worker URL = `http://127.0.0.1:8799`
- Access token = the same value as `ASK_TOKEN`

The keys the panel stores:

- `umeboshi-ask:worker-url:v1`
- `umeboshi-ask:worker-token:v1`

Then check the round-trip:

1. Ask a question and confirm a streaming answer comes back.
2. Save (threads POST), rebuild the panel, and confirm threads GET shows it again.
3. Change the token to a wrong value and ask. A 401 shows the
   "check the access token in settings" guide.

## Scripts

- `npm run build`: render the panel (`addon/templates/inject.html`).
- `npm run build:addon`: pack the `.ankiaddon` (run `build` first).
- `npm test`: root tests (`node --test`).
- `npm run test:core`: Worker core tests (`claudeflare/test/core`).

## Use as a package

Install [`@umeboshi/ask`](package.json) as a dependency to reuse its sources:

```sh
npm install @umeboshi/ask
```

It ships source files, not a ready-made JS SDK.

- `./core` (`claudeflare/src/core.ts`): the Worker core source.
- `./panel` (`src/components/askScaffold.ejs`): the panel source.
- `./addon` (`addon/inject.py`): the add-on entry.
- `./package.json`: package metadata only.

For Anki use, follow Setup above instead of importing these files directly.

## Contributing

See the [contribution guide](CONTRIBUTING.md) for questions, feature requests,
development setup, and pull requests. Participate in English;
translation tools are welcome.

## Boundary

The boundary guard (`test/oss-boundary.test.mjs`) keeps billing words out of
this tree. Do not bring billing words here (billing, Stripe, checkout,
credits as a balance, subscription, topup, promo, and their Japanese forms).
The per-model price field the Worker sends (`m.credits`) is received, not
introduced, and stays out of the scan as a property access.

## Troubleshooting

- 401: check the access token in the panel settings. It must match `ASK_TOKEN`.
- Save fails: without `[[kv_namespaces]]`, threads and settings cannot persist,
  and the panel falls back to local settings.
- Chat returns 503: `OPENROUTER_API_KEY` is not set.
- Browser blocks the call: check CORS. The core answers known origins only
  (Anki Desktop, AnkiWeb, loopback for AnkiDroid, and same origin).

## FAQ

- Where does my card go?
  The panel sends the composed question to your Worker. Your Worker forwards it
  to OpenRouter, which forwards it to the selected model provider. Self-hosted
  means you run the entry point yourself; the answer itself is not made on
  your machine.
- Which models exist?
  The fixed bundle has 5 entries:
  `xiaomi/mimo-v2.5`,
  `z-ai/glm-5.3-flash`,
  `xiaomi/mimo-v2.6-pro`,
  `google/gemini-3.8-flash`,
  `anthropic/claude-opus-5.5`.
- What is needed to save?
  `ASK_TOKEN` and a KV binding.
  Without them, threads and settings stay on the device only.

## Get help

- [Report a bug](https://github.com/Karimuto/umeboshi-ask/issues/new?template=bug_report.md).
- [Suggest a feature](https://github.com/Karimuto/umeboshi-ask/issues/new?template=feature_request.md).
- [Get self-hosting help](https://github.com/Karimuto/umeboshi-ask/issues/new?template=selfhost_help.md).
- Use [Discussions](https://github.com/Karimuto/umeboshi-ask/discussions)
  to share how you use it or exchange tips.

## Hosted version

A hosted version exists
for those who do not want to self-host.
The only differences are login,
payment, and sync.
This repo has none of those.
Ask the maintainer
for the hosted version.
