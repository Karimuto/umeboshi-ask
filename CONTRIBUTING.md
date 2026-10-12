# Contributing

Thanks for helping with the self-hosted build.

## Where to change

- Panel: `src/components/`
  (the source; `npm run build`
  renders `addon/templates/inject.html`).
- Worker core: `claudeflare/src/core.ts`
  and the modules it imports.
  Do not add routes or modules
  the core does not import.
- Add-on: `addon/`
  (Python, injection only).
- Docs: the files under `oss/`
  (`README.md`, `AGENTS.md`, and others).

## How to send a PR

1. Keep the change small and focused.
2. Run the checks before you push:
   `npm run build`, `npm test`,
   `npm run test:core`.
3. Describe what you changed
   and how you tested it.

## What not to bring

This repo has no paid plans,
no login, and no sync.
Do not add code for those.
The boundary guard
(`test/oss-boundary.test.mjs`)
must stay green.
It rejects words tied to paid plans,
so do not introduce them.
