# System Design, Visually

Learn system design by watching systems break and fixing them. Every lesson starts with a failure, asks you to predict
what happens, then lets you play with an honest simulation until the fix makes sense.

**Live site:** https://ronaldndirangu.github.io/system-design-visual/

## What is inside

- **A full course of 63 lessons in nine modules**: thinking in systems, foundations, scaling, reliability, async and
  event driven systems, distributed data, ten case studies, AI systems, and interview practice. Each case study names
  the module it builds on.
- **One running example for the scaling arc**: a URL shortener grows from a single server to 100 million users, gaining
  one component per lesson (load balancers, caches, read replicas, shards). Later modules switch to examples that fit
  the workload: chat for ordering, news feed for fan out, payments for idempotency and sagas.
- **Quick cards**, such as the design checklist: short reference pages of ten minutes or less.
- **Interactive simulations** on every lesson. Physics-driven requests pile into server queues and spill over when a
  server melts. A cache warms up under Zipf traffic. Replicas serve stale reads. A hash ring reshuffles keys as shards
  join and leave.
- **The same lesson rhythm every time:** objectives, a failure hook, a prediction, a step-by-step diagram with an
  analogy, a simulation, a trade-off table, a quiz that explains every answer, and a design challenge.
- **Progress saved on this device** in `localStorage`, with a reset control.

Every simulation runs on a small deterministic model (seeded random numbers), and every visual has a live text readout,
keyboard controls, and a reduced motion fallback.

## Tech stack

| Layer          | Choice                                                                       |
| -------------- | ---------------------------------------------------------------------------- |
| Site framework | [Astro](https://astro.build) with [Starlight](https://starlight.astro.build) |
| Interactivity  | React islands, hydrated with `client:visible`                                |
| Animation      | [Motion](https://motion.dev) for SVG and UI transitions                      |
| Physics        | [Matter.js](https://brm.io/matter-js/), loaded only when a scene appears     |
| Search         | Pagefind (built into Starlight)                                              |
| Quality        | TypeScript strict, Biome, `astro check`, Vitest, Playwright with axe         |
| Hosting        | GitHub Pages, deployed by GitHub Actions                                     |

## Local development

You need Node.js 22.23.4 or newer (the repo pins Node 26 in `.nvmrc`) and pnpm. Corepack picks the exact pnpm version
from `package.json`.

```sh
corepack enable
pnpm install
pnpm dev
```

Open http://localhost:4321/system-design-visual/. The site always serves under the `/system-design-visual/` base path,
the same as on GitHub Pages.

## Scripts

| Command         | What it does                                                    |
| --------------- | --------------------------------------------------------------- |
| `pnpm dev`      | Starts the dev server with hot reload                           |
| `pnpm build`    | Builds the static site into `dist/`                             |
| `pnpm preview`  | Serves the production build locally                             |
| `pnpm lint`     | Lints and checks formatting with Biome                          |
| `pnpm lint:fix` | Applies safe lint fixes and formatting                          |
| `pnpm check`    | Type checks `.astro`, `.ts`, `.tsx`, and MDX with `astro check` |
| `pnpm test`     | Runs the Vitest unit tests for the simulation models            |
| `pnpm test:e2e` | Runs Playwright smoke and axe accessibility tests               |
| `pnpm verify`   | Runs lint, type check, unit tests, and build in order           |

The first `pnpm test:e2e` run needs a browser: `pnpm exec playwright install chromium`.

## Project structure

```text
src/
  content/docs/          Pages and lessons (MDX). The folder path is the URL.
    index.mdx            Landing page
    thinking/ foundations/ scaling/ ...   One lesson folder per module
  data/
    curriculum.ts        Single source of truth for modules and lessons
    sidebar.ts           Builds the Starlight sidebar from the curriculum
  lib/
    models/              Pure, deterministic simulation models (unit tested)
    progress.ts          Versioned localStorage progress store
    rng.ts               Seeded random numbers and distributions
  components/
    lesson/              Lesson building blocks: Objectives, Predict, Quiz, Challenge...
    sim/                 Simulation frame, ticker, controls, readout tables
    viz/                 Diagram primitives: component shapes, icons, flow dots
    physics/             Matter.js scenes for requests as falling balls
    widgets/             One interactive widget per lesson topic
    landing/             Landing hero and course map
    overrides/           Starlight component overrides
  styles/                Theme tokens and component styles
tests/
  unit/                  Vitest model and data tests
  e2e/                   Playwright smoke and accessibility tests
.github/workflows/       CI (pull requests and pushes) and Pages deploy
```

## Deployment

`.github/workflows/ci.yml` checks every pull request and every push to `main`. It lints, type checks, runs the unit
tests, and builds the site. On `main`, its deploy job publishes that `dist/` with the official GitHub Pages actions,
so a commit that fails any of those checks never goes live. To redeploy by hand, run the CI workflow on `main` from the
Actions tab. The browser tests run on pull requests and `main` pushes that change components, shared code, styles,
tests, or config, and every night against the whole site; content-only changes skip them. A failing browser test
blocks the pull request through the required `CI result` check, and three shards keep a run to a few minutes. On
`main` they never hold back a deploy. They run inside the official Playwright container image, whose tag CI reads from
the `@playwright/test` version in `pnpm-lock.yaml`, and reuse the `dist/` that the verify job built: every page in both
themes, phone width, and the link crawl.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the lesson template, the visual language, and the checks to run before you
open a pull request.

## License

No license has been chosen yet. Until one is added, all rights are reserved by the author.
