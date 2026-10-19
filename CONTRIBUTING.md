# Contributing

Use English for issues, discussions, pull requests, and review comments.
If you prefer another language, use a translation tool before posting.

## Where to start

- [Report a bug](https://github.com/Karimuto/umeboshi-ask/issues/new?template=bug_report.md).
- [Suggest a feature](https://github.com/Karimuto/umeboshi-ask/issues/new?template=feature_request.md).
  A rough idea is enough; you do not need a design.
- [Get self-hosting help](https://github.com/Karimuto/umeboshi-ask/issues/new?template=selfhost_help.md).
- Use [Discussions](https://github.com/Karimuto/umeboshi-ask/discussions)
  to share how you use ask or exchange tips with other users.

Feature requests go straight to issues. You do not need a discussion first
or a second post in another category. If you pick the wrong place,
the maintainer will help you find the right one.

You can send a pull request (PR) directly for a typo, a documentation improvement,
or a small, clearly defined bug fix. Open an issue first for a new feature
or a change that substantially affects behavior or structure.
If you are unsure, ask in an issue before starting.

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
- Docs: `README.md`, `README.ja.md`, and the community-file sources under `oss/`.
  For this guide, edit `oss/CONTRIBUTING.md` and keep the root copy in sync.

## Set up a development copy

Use Node.js 24 LTS with npm and Git. Run these commands in a terminal:

```sh
git clone https://github.com/Karimuto/umeboshi-ask.git
cd umeboshi-ask
npm install
cd claudeflare
npm install
cd ..
```

The second install supplies the Worker core's development tools.
The root install alone is not enough to run its tests.
Wrangler 3.114.17 works with this project; keep Wrangler on 3.x.
You do not need a Cloudflare account or production credentials for the tests.

## Check a code change

From the repository root, run:

```sh
npm run build
npm test
npm run test:core
```

The build renders the panel. The root tests cover the panel and the boundary
guard; the core tests cover the Worker.
The root command uses explicit file globs, which also work on Node.js 24:

```sh
node --test "test/*.test.mjs" "test/lib/*.test.mjs"
```

For Python add-on changes, also run these tests with Python 3
(`python` instead of `py` on systems without the Windows launcher):

```sh
py addon/test_addon.py
py addon/test_inject.py
```

### Check panel and add-on behavior in Anki

Use Anki Desktop 25.09.2 or later and a separate test profile.

1. Run `npm run build` and `npm run build:addon`.
   The package is `umeboshi-ask-companion.ankiaddon` in the repository root.
2. In Anki, open Tools > Add-ons > Install from File, select the package,
   and restart Anki.
3. Open Tools > Add-ons and choose `umeboshi-ask: Inject ask`.
   Select a test note type and press Apply.
4. Review a card of that note type and show its answer.
   Check that the panel appears, then exercise the behavior you changed.
   For Worker setup and a chat/save round-trip, follow
   [Setup in the README](README.md#setup-3-steps).
5. Include the Anki version, operating system, steps, and observed result
   in your PR. For a visible change, include a screenshot.

Documentation-only changes do not need an unrelated Anki run.
If you cannot run a required check, say which one and why.
You can still submit the PR; the maintainer must complete the necessary
checks before merging.

## How to send a PR

1. Fork the public repository to make your own copy on GitHub.
   Push your change to a branch in your fork, then open a PR against
   `Karimuto/umeboshi-ask`'s `main` branch.
   See GitHub's [guide to contributing](https://docs.github.com/en/get-started/exploring-projects-on-github/contributing-to-a-project).
2. Keep the change small and focused. Link the issue if there is one.
3. Describe what you changed, why, how you tested it, and any checks
   you could not run.

Write short, descriptive commit messages in English, such as
`Fix typo in setup instructions`. Prefixes such as `fix:` and `docs:`
are optional.

The maintainer reviews the purpose and scope of the change, its effect
on existing behavior, and whether the documentation matches.
Required checks must pass before the PR is merged.

## Keep both READMEs current

`README.md` is the English source; `README.ja.md` is its Japanese translation.
Keep both versions consistent when changing their content.
A translation tool is fine. If you need help, note it in the PR;
the maintainer can complete the translation before merging.

## License and participation

By contributing, you agree to provide your changes under the
[MIT License](LICENSE). Only submit work you have the right to contribute.
We do not require a separate contributor agreement (CLA) or DCO sign-off.

We do not have a separate Code of Conduct.
We rely on contributors' good judgment.

## What not to bring

This repo has no paid plans,
no login, and no sync.
Do not add code for those.
The boundary guard
(`test/oss-boundary.test.mjs`)
must stay green.
It rejects words tied to paid plans,
so do not introduce them.
