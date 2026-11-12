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

Open `src/data/curriculum.ts`, find the module, and add the lesson. The lesson `id` is also its URL and file path, for
example `reliability/timeouts`.

The sidebar, the course map, pagination, the lesson header, and progress tracking all read from this file. Unit tests
fail if a lesson has no page, if a page in a module folder is missing from the curriculum, or if any source file says
"coming soon".

Every lesson declares:

- `minutes`: the time the header shows. A unit test keeps it within 25% of the time computed from the page (see
  [Lesson template](#lesson-template)), so run `pnpm lint:lessons` and copy the computed value when unsure.
- `difficulty`: `1` (Foundational), `2` (Intermediate) or `3` (Advanced). The header shows it as three dots plus the
  word, and the course map marks level 3 lessons as advanced.

Optional fields:

- `buildsOn: ['<lesson id>', ...]` lists earlier lessons this one assumes. The header links them as "Builds on" chips,
  `<Recall />` quizzes them, and a unit test checks that each one exists and comes earlier in the course.
- `example: '<system>'` names the running example when it differs from the module's, for example `'Chat'`.
- `drillMinutes` adds fixed time for a timed drill the page asks for, so the computed minutes stay honest.

Two more optional fields shape how the course map presents a lesson:

- `format: 'card'` marks a quick card: a short reference page of ten minutes or less. A unit test enforces the limit.
- `bestAfter: '<module id>'` names an earlier module the lesson builds on, for example `bestAfter: 'reliability'` on a
  case study. The map shows a "Best after module N" badge, and a unit test checks that the module comes earlier.

### 2. Create the page

Add `src/content/docs/<id>.mdx`, for example `src/content/docs/reliability/timeouts.mdx`:

```mdx
---
title: Timeouts
description: One sentence that says what the learner will be able to do.
furtherReading:
  - title: A primary source, such as a paper or official documentation
    url: https://example.com/source
    note: One line on what the learner gets from it.
---

import Recall from '../../../components/lesson/Recall.astro';
import Objectives from '../../../components/lesson/Objectives.astro';
import Analogy from '../../../components/lesson/Analogy.astro';
import TradeoffTable from '../../../components/lesson/TradeoffTable.astro';
import KeyTakeaways from '../../../components/lesson/KeyTakeaways.astro';
import Challenge from '../../../components/lesson/Challenge.astro';
import Predict from '../../../components/lesson/Predict';
import Quiz from '../../../components/lesson/Quiz';
import StepDiagram from '../../../components/lesson/StepDiagram';

export const recall = [
  {
    id: 'reliability/timeouts/recall-1',
    prompt: 'A question on a lesson listed in buildsOn?',
    options: [
      { text: 'The right answer', correct: true, why: 'Why it is right.' },
      { text: 'A tempting wrong answer', why: 'Why it is wrong.' },
    ],
  },
];

export const quiz = [
  {
    id: 'reliability/timeouts/q1',
    prompt: 'A question about the core idea?',
    options: [
      { text: 'A tempting wrong answer', why: 'Why it is wrong.' },
      { text: 'The right answer', correct: true, why: 'Why it is right.' },
    ],
  },
];

<Recall questions={recall} />

<Objectives>

- What the learner will be able to explain or do.

</Objectives>

## The failure: something breaks

<Predict
  client:visible
  id="reliability/timeouts/predict-1"
  question="What happens next?"
  options={['A', 'B', 'C']}
  answer={1}
  why={['Why A is wrong.', 'Why B is right.', 'Why C is wrong.']}
>

<div slot="figure">

![A static picture of the failure, so the learner predicts from evidence.](./timeouts-failure.svg)

</div>

The reveal, shown after the learner locks in a guess.

</Predict>

<KeyTakeaways>

- One sentence per idea the learner should keep.

</KeyTakeaways>

<Quiz client:visible questions={quiz} />

<Challenge>

A small design problem in a new setting.

<div slot="answer">

One possible answer, with the trade-off it accepts.

</div>

</Challenge>
```

#### Lesson template

The lesson header comes from the curriculum: module chip, position ("12 / 56"), level, minutes, the running example,
"Builds on" chips, and a "Jump to simulation" link when the page has a simulation. The footer adds Mark complete, the
next lesson, and the `furtherReading` sources from the frontmatter. Between them, a lesson follows this order:

1. **Recall** (`<Recall />`): one or two questions on the `buildsOn` lessons, passed as `questions`. Learners can skip
   it. Lessons with no `buildsOn` show nothing here.
2. **Objectives** (`<Objectives>`): three or four "you will be able to" outcomes.
3. **The failure**: a concrete story of the system breaking, then `<Predict client:visible>` so the learner commits to
   a guess before the reveal. Put a static picture of the failure in the `figure` slot and one line per option in
   `why`.
4. **Mental model**: one `<StepDiagram client:visible>` (or a static `<ArcDiagram stage="...">`) plus an `<Analogy>`
   that says where the analogy breaks.
5. **Guided experiment**: a widget from `src/components/widgets/`, hydrated with `client:visible`, with baseline,
   intervention and counterexample presets.
6. **Deep dives**: two to four h3 sections. Put advanced material in a "Go deeper" `<details>` block, which the
   minutes and word counts skip.
7. **Trade-offs** (`<TradeoffTable title="...">` wrapping a Markdown table) and when not to use the idea.
8. **Common mistakes**: three to five bullets.
9. **Key takeaways** (`<KeyTakeaways>`): three to five bullets.
10. **Check yourself** (`<Quiz client:visible>`): four questions covering an explanation, a calculation, a
    misconception and a transfer to a new setting. Every option needs a `why`, including the right one.
11. **Design challenge** (`<Challenge>` with a `<div slot="answer">`): a small design problem in a new setting.

For other asides, use `<Callout variant="note">` or `<Callout variant="warning">` from
`src/components/lesson/Callout.astro`. Each variant brings its own icon and overline; pass `title` to change the
overline. Objectives, Analogy, KeyTakeaways and Challenge are Callout variants too, so all asides share one look.

Computed minutes count 200 words per minute in the core path, plus 3 minutes per simulation, 1 per Predict, quiz
or recall question, and any `drillMinutes`. The declared `minutes` must land within 25% of that value.

`pnpm lint:lessons` checks every page against the template and prints each finding:

| Rule       | Lesson                                                                                      | Quick card                     | Case study                                              |
| ---------- | ------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------- |
| Components | Recall (with `buildsOn`), Objectives, Predict, KeyTakeaways, Quiz, Challenge, in that order | Objectives, KeyTakeaways, Quiz | Recall (with `buildsOn`), KeyTakeaways, Quiz, Challenge |
| h2 count   | 5 to 8                                                                                      | any                            | 8 to 14                                                 |
| Core sims  | at most 2                                                                                   | at most 1                      | at most 4                                               |
| Core words | 1,200 to 2,500                                                                              | 500 to 900                     | 2,000 to 6,000                                          |
| Links      | 3 or more to other lessons, one to a `buildsOn` lesson                                      | 1 or more                      | 3 or more                                               |

Every page also needs unique, well-formed question ids and declared minutes that match the computed value. Lessons
written before the template are listed in `scripts/lesson-lint-legacy.json` and report warnings; every other lesson
fails `pnpm lint` on any finding. When a legacy lesson passes, the full report tells you to remove it from that list.

Every quiz question and every `<Predict>` needs an `id` of the form `<lesson id>/qN` or `<lesson id>/predict-N`.
Saved progress keys on it, so never change an `id` once published, even when you reorder or reword questions. A unit
test checks that every `id` exists, is unique and has the right form. Choices display in a shuffled order seeded by the
`id`, and a unit test fails if more than 40% of a component's answers land in the same position. When the options form
a scale (1, 10, 100), add `ordered` (`ordered: true` in a quiz question) to keep their sequence; the display direction
then flips on each retry.

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
both light and dark color schemes. To run the faster pull request subset locally, set `E2E_MODE=pr` and list the pages
in `E2E_PAGES`, for example `E2E_PAGES=scaling/caching/`. CI picks the pages from your diff and runs the full sweep on
`main` and every night.
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
| Model         | Chip with pins on both sides and a sparkle icon        | Fuchsia  | A machine learning model that turns input into output |
| Vector index  | Slanted card with a scatter plot icon                  | Lime     | Finds stored items whose embeddings are closest       |

Status always pairs a color with an icon and a word: **Healthy** (check), **Strained** (exclamation mark), and **Down**
(cross). In physics scenes, requests are balls: a solid ball is waiting, a ring was served, and a cross was dropped.

When you add a new kind of component, add it to `kinds.ts`, `SystemNode.tsx`, and `icons.tsx`, give it a color for both
themes (the AI kinds keep theirs in `src/components/viz/aiKinds.css`), then update this table. The AI systems module
draws an AI gateway with the load balancer shape and a tool with the server shape, since both are ordinary services.

## Pull requests

- Keep each pull request focused: one lesson, one fix, or one feature.
- CI must pass: lint, type check, unit tests, build, and browser tests.
- Include a screenshot or short clip of any new visual.
