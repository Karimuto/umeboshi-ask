# AGENTS (public repo)

How to build and test this repo.

## Build

```sh
npm run build         # render the panel (needs ejs)
npm run build:addon   # pack the .ankiaddon (run build first)
```

## Test

```sh
npm test              # root tests
npm run test:core     # Worker core tests (claudeflare/test/core)
```

`test:full` does not exist here. It covers the hosted worker, which is not
in this repo.

## Boundary

`test/oss-boundary.test.mjs` keeps billing words out of this tree.
Keep it green. Do not bring billing words here
(billing, Stripe, checkout, credits as a balance, subscription, topup,
promo, and their Japanese forms).
