# System Design, Visually

Learn system design by watching systems break and fixing them. Every lesson starts with a failure, asks you to predict
what happens, then lets you play with an honest simulation until the fix makes sense.

**Live site:** https://ronaldndirangu.github.io/system-design-visual/

## What is inside

- **A full course map** of nine modules: thinking in systems, foundations, scaling, reliability, async and event
  driven systems, distributed data, ten case studies, AI systems, and interview practice. Each lesson shows whether it
  is ready or coming soon, and each case study names the module it builds on.
- **Six complete lessons** that grow one URL shortener from a single server to 100 million users:
  1. Requirements and estimates
  2. What happens when you click a link
  3. The server melts: scaling out and load balancing
  4. Caching
  5. Read replicas
  6. Sharding and consistent hashing
- **A design checklist card**: a five-minute walk through the seven steps of any design, answered for the URL
  shortener.
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
    thinking/ foundations/ scaling/   Lesson folders, one per module (more arrive as lessons ship)
  data/
    curriculum.ts        Single source of truth for modules, lessons, and status
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

Every push to `main` runs `.github/workflows/deploy.yml`. It lints, type checks, runs the unit tests, builds the site,
and publishes `dist/` with the official GitHub Pages actions. `ci.yml` runs the same checks plus the browser tests on
every pull request. The browser tests run inside the official Playwright container image, whose tag CI reads from the
`@playwright/test` version in `pnpm-lock.yaml`, so a dependency bump updates the browser image too. They reuse the
`dist/` that the verify job built. On a pull request they check only the pages the PR changes plus a fixed sample, in
dark mode (`scripts/e2e-scope.ts` picks them from the diff). Pushes to `main`, a nightly schedule, and any pull request
that touches shared code or config run the full sweep: every page in both themes, phone width, and the link crawl.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the lesson template, the visual language, and the checks to run before you
open a pull request.

## License

No license has been chosen yet. Until one is added, all rights are reserved by the author.
