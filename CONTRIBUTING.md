# Contributing

Thanks for helping people learn system design. This guide covers how lessons are built, the visual language every
diagram follows, and the checks to run before a pull request.

## Ground rules

- **Problem first.** Each lesson opens with something breaking. The fix arrives only after the learner has felt the
  pain and made a prediction.
- **Honest models.** Simulations simplify, and they never lie. Keep each model small, deterministic (seeded random
  numbers), and unit tested. When a lesson quotes a number, a unit test should pin it.
- **Accessible by default.** Every visual needs a text readout, keyboard controls, and a reduced motion fallback. Color
  never carries meaning on its own.
- **Plain writing.** Short sentences, active voice, concrete nouns. Do not use em dashes or en dashes; rewrite with
  commas, colons, parentheses, or two sentences.

## Local setup

```sh
corepack enable
pnpm install
pnpm dev
```

Before you push, run `pnpm verify` (lint, type check, unit tests, build) and `pnpm test:e2e`.
End to end tests serve the build on port 4321. Set `E2E_PORT` to use another port, for example when two checkouts run tests at once.

## How to add a lesson

### 1. Register it in the curriculum

Open `src/data/curriculum.ts`, find the module, and set the lesson's `status` to `'ready'` with an estimate in
`minutes`. The lesson `id` is also its URL and file path, for example `reliability/timeouts`.

The sidebar, the course map, pagination, and progress tracking all read from this file. A unit test fails if a ready
lesson has no page, or if a coming soon lesson already has one.

Two optional fields shape how the course map presents a lesson:

- `format: 'card'` marks a quick card: a short reference page of ten minutes or less. A unit test enforces the limit.
- `bestAfter: '<module id>'` names an earlier module the lesson builds on, for example `bestAfter: 'reliability'` on a
  case study. The map shows a "Best after module N" badge, and a unit test checks that the module comes earlier.

### 2. Create the page

Add `src/content/docs/<id>.mdx`, for example `src/content/docs/reliability/timeouts.mdx`:

```mdx
---
title: Timeouts
description: One sentence that says what the learner will be able to do.
---

import Objectives from '../../../components/lesson/Objectives.astro';
import Analogy from '../../../components/lesson/Analogy.astro';
import TradeoffTable from '../../../components/lesson/TradeoffTable.astro';
import Challenge from '../../../components/lesson/Challenge.astro';
import Predict from '../../../components/lesson/Predict';
import Quiz from '../../../components/lesson/Quiz';
import StepDiagram from '../../../components/lesson/StepDiagram';

export const quiz = [
  {
    prompt: 'A question about the core idea?',
    options: [
      { text: 'A tempting wrong answer', why: 'Why it is wrong.' },
      { text: 'The right answer', correct: true, why: 'Why it is right.' },
    ],
  },
];

<Objectives>

- What the learner will be able to explain or do.

</Objectives>

## The failure: something breaks

<Predict client:visible question="What happens next?" options={['A', 'B', 'C']} answer={1}>

The reveal, shown after the learner locks in a guess.

</Predict>

<Quiz client:visible questions={quiz} />
```

Follow the lesson rhythm, in this order:

1. **Objectives** (`<Objectives>`): three or four outcomes.
2. **Failure hook**: a short story of the system breaking.
3. **Predict** (`<Predict client:visible>`): the learner commits to a guess before the reveal.
4. **Step-by-step diagram** (`<StepDiagram client:visible>`) or a static `<ArcDiagram stage="...">`, plus an
   `<Analogy>`.
5. **Simulation**: a widget from `src/components/widgets/`, hydrated with `client:visible`.
6. **Trade-offs** (`<TradeoffTable title="...">` wrapping a Markdown table).
7. **Quiz** (`<Quiz client:visible>`): every option needs a `why`, including the right one.
8. **Challenge** (`<Challenge>` with a `<div slot="answer">`): a small design problem in a new setting.

Quick cards skip the full rhythm. Keep them to one focused idea, use Starlight's `<Steps>` or a table for structure,
and end with a short `<Quiz client:visible>` so the learner still retrieves what they read.

MDX tips:

- Leave a blank line before and after Markdown inside a component, or it renders as plain text.
- Link to other pages with relative paths and a trailing slash, for example `[caching](../caching/)`. Absolute
  Markdown links skip the `/system-design-visual/` base path.
- Put data for components in `export const` blocks at the top of the file.

### 3. Build the simulation

Keep logic and visuals apart:

- **Model** in `src/lib/models/<topic>.ts`: a plain TypeScript class or function with no DOM access. Advance time in
  fixed ticks, take a `seed`, and draw randomness only from `createRng` in `src/lib/rng.ts`.
- **Tests** in `tests/unit/<topic>.test.ts`: pin every number the lesson text quotes, and check that the same seed
  replays the same run.
- **Widget** in `src/components/widgets/<Topic>Widget.tsx`:
  - Wrap time-based simulations in `SimulationShell` (Play, Pause, Step, Reset, speed, a stats table, and a live
    announcement). Wrap control-driven widgets in `WidgetFrame`.
  - Pass a `summary` sentence and `stats` rows so the result is readable without the visual.
  - Draw components with `SystemNode` and animate traffic with `FlowDots` from `src/components/viz/`.
  - Wrap wide SVG diagrams in `DiagramScroll` so they keep a legible minimum width on phones and scroll sideways
    (keyboard users can focus and scroll it). `StepDiagram` already fits its view box to its nodes and scrolls the
    same way, so pass `width` only to override the fit.
  - Use `usePrefersReducedMotion` to swap motion for a static or stepped view.
  - For physics, extend the Matter.js scenes in `src/components/physics/` and import them dynamically so the engine
    only loads when the scene scrolls into view. Physics shows the model's results; it never decides them.

Avoid a general-purpose simulator. A lesson needs one small model that tells one true story.

#### Comparing two strategies

When a lesson contrasts two choices (round robin and least connections, for example), run both on the same traffic
side by side. The load balancing lesson's `BalancerDuelWidget` is the reference.

- **Model contract.** Implement `ModelAdapter` from `src/lib/models/adapter.ts`: time moves only through `step()`,
  `apply()` queues a change for the next tick, and `checkpoint()` and `restore()` copy every random stream. Scripted
  events (a server crash at 3 seconds) go in a `ScheduledCommand` list run by `stepScheduled`, so widgets and tests
  replay them the same way.
- **Same traffic, both panes.** Give arrivals and service times separate random streams, seeded identically in both
  panes. Then any gap in the results comes from the strategy alone.
- **One shell.** Put both panes inside a single `SimulationShell` so one Play button drives both. Pass a `readout` with
  a `CompareTable` in place of `stats`.
- **Scenarios as chips.** Offer two or three presets with `ScenarioChips`. Each chip states its `diff` in plain words
  (for example, "Each slow one takes 20 times as long; the average stays 10 ms"), so no choice hides its parameters. Changing the chip resets
  the model; pass the scenario id as the shell's `resetKey` so playback pauses too.
- **Trace over time.** `TraceChart` draws one solid and one dashed line, so the series differ without color. Number the
  key moments with `markers` and explain each one in the text transcript below the chart.
- **Honest badges.** `CompareTable` marks a value "Better" only through `betterIndex` in `src/lib/compare.ts`. Values
  that format identically, or differ by less than `TIE_MARGIN` (5%), tie and get no badge. Include at least one chip
  where the strategies tie, so learners see when a choice does not matter.
- **Tests.** Pin each scenario's headline numbers for a fixed seed, assert the same seed replays identically, and test
  that `checkpoint()` then `restore()` reproduces the same future ticks.

Keep the parameters realistic. Never tune them to widen a gap; if the effect is small, the lesson says so.

### 4. Check it

```sh
pnpm verify
pnpm test:e2e
```

The browser tests open every ready lesson, hydrate every widget, fail on console errors or broken links, and run axe in
both light and dark color schemes.
Also try the lesson with the keyboard only, in dark and light themes, at phone width, and with reduced motion turned
on in your operating system.

## Visual language

Every diagram uses the same shape, color, and icon for each kind of component. Shape and icon carry the meaning, so the
diagrams still read in grayscale. The source of truth is `src/components/viz/kinds.ts`, and the site renders it on the
[visual language page](https://ronaldndirangu.github.io/system-design-visual/visual-language/).

| Component     | Shape                                                  | Color    | Role                                                  |
| ------------- | ------------------------------------------------------ | -------- | ----------------------------------------------------- |
| Client        | Rounded rectangle with a screen icon                   | Blue     | A browser or app that starts a request                |
| DNS           | Card with a folded corner and a globe icon             | Teal     | Turns a name into an IP address                       |
| Server        | Rack box with side stripes                             | Violet   | Runs your application code                            |
| Load balancer | Hexagon with a split arrow                             | Amber    | Spreads requests across servers, skips unhealthy ones |
| Cache         | Square with a dashed inner border and a lightning bolt | Rose     | Keeps popular answers in memory                       |
| Database      | Cylinder                                               | Green    | Stores data durably on disk                           |
| Queue         | Pill with slots                                        | Cyan     | Holds work until a consumer is ready                  |
| CDN           | Cloud                                                  | Sky blue | Serves content close to people                        |

Status always pairs a color with an icon and a word: **Healthy** (check), **Strained** (exclamation mark), and **Down**
(cross). In physics scenes, requests are balls: a solid ball is waiting, a ring was served, and a cross was dropped.

When you add a new kind of component, add it to `kinds.ts` and `SystemNode.tsx`, then update this table.

## Pull requests

- Keep each pull request focused: one lesson, one fix, or one feature.
- CI must pass: lint, type check, unit tests, build, and browser tests.
- Include a screenshot or short clip of any new visual.
