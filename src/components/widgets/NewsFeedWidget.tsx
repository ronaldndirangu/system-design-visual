import { useReducer, useRef, useState } from 'react';
import {
  CELEBRITY_BATCH,
  CELEBRITY_THRESHOLD,
  demandPerSecond,
  duelScenarioIds,
  FeedDuel,
  type FeedDuelId,
  type FeedLane,
  type FeedScenarioId,
  type FeedSummary,
  FRESH_SECONDS,
  feedScenarios,
  GRID_COLS,
  latestLoad,
  loadCost,
  MAX_FOLLOWERS,
  MIN_FOLLOWERS,
  oldestLoadWaitSeconds,
  POSTS,
  queueView,
  READ_TARGET_SECONDS,
  summarize,
  type TileView,
  tileView,
} from '../../lib/models/newsFeed';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import './NewsFeedWidget.css';

interface Props {
  duel: FeedDuelId;
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];
const postIds = Array.from({ length: POSTS }, (_, id) => id);
const HEAD_SLOTS = 10;
const headSlots = Array.from({ length: HEAD_SLOTS }, (_, slot) => slot);
const secondsText = (value: number) => `${value.toFixed(1)} s`;
const count = (value: number) => value.toLocaleString('en-US');
const plural = (value: number, one: string, many: string) => `${count(value)} ${value === 1 ? one : many}`;

const glyphs: Record<TileView, string> = {
  future: '',
  waiting: '',
  overdue: '!',
  onTime: '✓',
  late: '!',
};

const copy: Record<FeedDuelId, { title: string; instructions: string; chart: string }> = {
  celebrity: {
    title: 'Same posts, two ways to fan out',
    instructions: `Pick a scenario, then press Play. Both lanes get the same 60 ordinary posts, the same celebrity post, and the same readers, and both share a fanout fleet of the same size. Only the fan-out rule differs: one lane copies every post into every follower's feed, the other skips the copies for any author with more than ${count(CELEBRITY_THRESHOLD)} followers and merges those posts in when a follower loads their feed.`,
    chart: 'Feed writes waiting to run',
  },
  reads: {
    title: 'Same feed loads, two ways to build a feed',
    instructions:
      'Pick a scenario, then press Play. Both lanes get the same posts and the same feed loads, and both read through a read tier of the same size. Only the fan-out rule differs: one lane builds each feed at read time from the list of every account the reader follows, the other reads one feed that fanout wrote ahead of time.',
    chart: 'Feed loads waiting for the read tier',
  },
};

type Link = { tone: 'ok' | 'warn' | 'bad'; icon: string; text: string };

/** The shared situation both lanes face after the last tick that ran. */
function sharedState(duel: FeedDuel, celebrityDuel: boolean): Link {
  const tick = duel.ticks - 1;
  if (celebrityDuel) {
    if (duel.celebrityTick < 0) {
      return {
        tone: 'ok',
        icon: '✓',
        text: 'No celebrity in this run. Every author has 20 to 80 followers, so both lanes fan out every post on write.',
      };
    }
    if (tick < duel.celebrityTick) {
      return {
        tone: 'ok',
        icon: '✓',
        text: `Ordinary posts only so far. Each one needs ${MIN_FOLLOWERS} to ${MAX_FOLLOWERS} feed writes.`,
      };
    }
    if (duel.lanes[0].state.celebrityDoneTick >= 0) {
      return {
        tone: 'ok',
        icon: '✓',
        text: `Every one of the celebrity's ${count(duel.celebrityFollowers)} followers can see the post in both lanes.`,
      };
    }
    const rate = Math.round(duel.scenario.writesPerTick / duel.tickSeconds);
    return {
      tone: 'warn',
      icon: '≡',
      text: `A celebrity with ${count(duel.celebrityFollowers)} followers has posted. Copying it into every feed takes ${count(duel.celebrityFollowers)} feed writes, and the fleet runs ${count(rate)} per second.`,
    };
  }
  const load = latestLoad(duel);
  const reads = load
    ? ` Latest feed load: a reader who follows ${load.follows} accounts. Fan out on read looks up ${load.follows} author lists; fan out on write reads 1 precomputed feed.`
    : '';
  const rate = (tickRate: number) =>
    `${count(Math.round(tickRate / duel.tickSeconds))} feed loads per second`;
  if (duel.peakTick < 0) {
    return {
      tone: 'ok',
      icon: '✓',
      text: `No peak in this run: ${rate(duel.scenario.loadsPerTick)}.${reads}`,
    };
  }
  if (tick >= duel.peakTick && tick < duel.peakEndTick) {
    return { tone: 'warn', icon: '▲', text: `Evening peak: ${rate(duel.loadsAt(tick))}.${reads}` };
  }
  const when = tick < duel.peakTick ? 'Normal traffic' : 'The peak has passed';
  return { tone: 'ok', icon: '✓', text: `${when}: ${rate(duel.scenario.loadsPerTick)}.${reads}` };
}

function PostGrid({ lane }: { lane: FeedLane }) {
  return (
    <div
      className="sdv-feedgrid"
      aria-hidden="true"
      style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}
    >
      {postIds.map((id) => {
        const view = tileView(lane, id);
        return (
          <span key={id} className="sdv-feedtile" data-view={view}>
            {glyphs[view]}
          </span>
        );
      })}
    </div>
  );
}

function FanoutQueue({ lane }: { lane: FeedLane }) {
  const queue = queueView(lane, HEAD_SLOTS);
  let text = 'Fanout queue empty.';
  if (queue.writes > 0) {
    const jobs: string[] = [];
    if (queue.celebrityJobs > 0) jobs.push(plural(queue.celebrityJobs, 'celebrity job', 'celebrity jobs'));
    if (queue.posts > 0) jobs.push(plural(queue.posts, 'post', 'posts'));
    text = `Queued: ${plural(queue.writes, 'feed write', 'feed writes')} in ${jobs.join(' and ')}.`;
    if (queue.posts > 0) {
      text +=
        queue.nextPostPlace === 1
          ? ' An ordinary post goes next.'
          : ` The next ordinary post is number ${queue.nextPostPlace} in line.`;
    }
  }
  return (
    <div className="sdv-feedq">
      <p className="sdv-feedq__title">Next jobs for the fanout fleet</p>
      <ol className="sdv-feedq__head" aria-hidden="true">
        {headSlots.map((slot) => {
          const kind = queue.head[slot];
          return (
            <li key={slot} className="sdv-feedq__item" data-kind={kind ?? 'empty'}>
              {kind === 'celebrity' ? 'C' : kind === 'post' ? 'P' : ''}
            </li>
          );
        })}
      </ol>
      <p className="sdv-feedq__text">{text}</p>
    </div>
  );
}

function ReadQueue({ duel, lane }: { duel: FeedDuel; lane: FeedLane }) {
  const queue = lane.state.readQueue;
  const costs = queue.map((id) => {
    const load = duel.loads[id];
    return load ? loadCost(lane.config.mode, load, duel.celebrityFollowers) : 0;
  });
  const owed = costs.reduce((sum, cost) => sum + cost, 0) - lane.state.headLookups;
  const text =
    queue.length === 0
      ? 'No feed load waiting.'
      : `Waiting: ${plural(queue.length, 'feed load', 'feed loads')} that still need ${plural(owed, 'lookup', 'lookups')}.`;
  return (
    <div className="sdv-feedq">
      <p className="sdv-feedq__title">Next feed loads for the read tier, with lookups each needs</p>
      <ol className="sdv-feedq__head" aria-hidden="true">
        {headSlots.map((slot) => {
          const cost = costs[slot];
          return (
            <li key={slot} className="sdv-feedq__item" data-kind={cost === undefined ? 'empty' : 'load'}>
              {cost ?? ''}
            </li>
          );
        })}
      </ol>
      <p className="sdv-feedq__text">{text}</p>
    </div>
  );
}

function Meter({ tone, share, text }: { tone: 'ok' | 'warn' | 'bad'; share: number; text: string }) {
  return (
    <div className="sdv-feedmeter" data-tone={tone}>
      <p className="sdv-feedmeter__text">
        {tone === 'bad' && <span aria-hidden="true">! </span>}
        {text}
      </p>
      <span className="sdv-feedmeter__track" aria-hidden="true">
        <span className="sdv-feedmeter__fill" style={{ width: `${Math.min(1, share) * 100}%` }} />
      </span>
    </div>
  );
}

function CelebrityMeter({ duel, lane, sum }: { duel: FeedDuel; lane: FeedLane; sum: FeedSummary }) {
  const followers = duel.celebrityFollowers;
  if (duel.celebrityTick < 0) return <Meter tone="ok" share={0} text="No celebrity in this run." />;
  if (duel.ticks <= duel.celebrityTick) {
    return <Meter tone="ok" share={0} text="Celebrity post: not posted yet." />;
  }
  if (lane.config.mode === 'hybrid') {
    return (
      <Meter
        tone="ok"
        share={1}
        text={`Celebrity post: stored once, with no feed writes. Each follower's feed load merges it in, so all ${count(followers)} followers see it at once.`}
      />
    );
  }
  if (sum.celebrityReachSeconds >= 0) {
    return (
      <Meter
        tone="ok"
        share={1}
        text={`Celebrity post: in all ${count(followers)} follower feeds, ${secondsText(sum.celebrityReachSeconds)} after it went up.`}
      />
    );
  }
  return (
    <Meter
      tone="warn"
      share={sum.celebrityWritten / followers}
      text={`Celebrity post: ${count(sum.celebrityWritten)} of ${count(followers)} follower feeds written, in jobs of ${CELEBRITY_BATCH}.`}
    />
  );
}

function ReadMeters({ duel, lane }: { duel: FeedDuel; lane: FeedLane }) {
  const capacity = Math.round((duel.scenario.readsPerTick ?? 0) / duel.tickSeconds);
  const demand = demandPerSecond(lane, duel);
  const demandTone = demand > capacity ? 'bad' : demand > capacity * 0.75 ? 'warn' : 'ok';
  const wait = oldestLoadWaitSeconds(lane, duel);
  const waitTone = wait > READ_TARGET_SECONDS ? 'bad' : wait > READ_TARGET_SECONDS / 2 ? 'warn' : 'ok';
  return (
    <>
      <Meter
        tone={demandTone}
        share={capacity === 0 ? 0 : demand / capacity}
        text={`Lookups asked for in the last second: ${count(demand)} per second. The read tier serves ${count(capacity)}.`}
      />
      <ReadQueue duel={duel} lane={lane} />
      <Meter
        tone={waitTone}
        share={wait / READ_TARGET_SECONDS}
        text={
          wait === 0
            ? 'Oldest waiting feed load: none.'
            : `Oldest waiting feed load: ${secondsText(wait)} of its ${READ_TARGET_SECONDS} s target${wait > READ_TARGET_SECONDS ? ', already slow' : ''}.`
        }
      />
    </>
  );
}

function LanePane({
  duel,
  lane,
  sum,
  variant,
  celebrityDuel,
}: {
  duel: FeedDuel;
  lane: FeedLane;
  sum: FeedSummary;
  variant: SeriesVariant;
  celebrityDuel: boolean;
}) {
  return (
    <section className="sdv-duel__lane" aria-label={lane.config.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.config.label}
      </h4>
      {celebrityDuel ? (
        <>
          <PostGrid lane={lane} />
          <div className="sdv-feed__tally">
            <p>
              Posts: {sum.onTime} in every feed within {FRESH_SECONDS} s, {sum.late} late, {sum.queued} still
              queued.
            </p>
            <p>
              Missed the {FRESH_SECONDS} s target: {sum.missed}.
            </p>
          </div>
          <CelebrityMeter duel={duel} lane={lane} sum={sum} />
          <FanoutQueue lane={lane} />
        </>
      ) : (
        <>
          <div className="sdv-feed__tally">
            <p>
              Feed loads: {count(sum.served)} served, {count(sum.slowLoads)} waited more than{' '}
              {READ_TARGET_SECONDS} s.
            </p>
            <p>
              Lookups so far: {count(sum.lookups)}. Feed writes so far: {count(sum.feedWrites)}.
            </p>
          </div>
          <ReadMeters duel={duel} lane={lane} />
        </>
      )}
    </section>
  );
}

function LegendTile({ view, text }: { view: TileView; text: string }) {
  return (
    <li>
      <span className="sdv-feedtile" data-view={view} aria-hidden="true">
        {glyphs[view]}
      </span>{' '}
      {text}
    </li>
  );
}

export default function NewsFeedWidget({ duel: duelId, title, instructions }: Props) {
  const hydrated = useHydrated();
  const scenarios = duelScenarioIds[duelId];
  const [scenarioId, setScenarioId] = useState<FeedScenarioId>(scenarios[0] ?? 'celebrity');
  const duelRef = useRef<FeedDuel | null>(null);
  if (!duelRef.current) duelRef.current = new FeedDuel(feedScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const restart = (id: FeedScenarioId) => {
    duelRef.current = new FeedDuel(feedScenarios[id]);
    rerender();
  };
  const onTick = () => {
    duel.step();
    rerender();
  };
  const skipToEnd = () => {
    while (!duel.done) duel.step();
    rerender();
  };
  const chooseScenario = (id: FeedScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const celebrityDuel = duelId === 'celebrity';
  const [first, second] = duel.lanes;
  const sums = [summarize(first, duel), summarize(second, duel)] as const;
  const seconds = duel.ticks * duel.tickSeconds;
  const runSeconds = duel.scenario.seconds;
  const text = copy[duelId];
  const shared = sharedState(duel, celebrityDuel);
  const pair = (pick: (sum: FeedSummary) => number): [number, number] => [pick(sums[0]), pick(sums[1])];

  const reachText = (value: number) =>
    duel.celebrityTick < 0 ? 'No celebrity' : value < 0 ? 'Not yet' : secondsText(value);
  const rows: CompareRow[] = celebrityDuel
    ? [
        { label: 'Posts published (same for both)', values: pair((sum) => sum.published) },
        {
          label: `In every follower's feed within ${FRESH_SECONDS} s`,
          values: pair((sum) => sum.onTime),
          better: 'higher',
        },
        { label: `Missed the ${FRESH_SECONDS} s target`, values: pair((sum) => sum.missed), better: 'lower' },
        {
          label: 'Average time to reach every follower',
          values: pair((sum) => sum.averageReachSeconds),
          format: secondsText,
          better: 'lower',
        },
        {
          label: 'Celebrity post in every follower feed after',
          values: pair((sum) => sum.celebrityReachSeconds),
          format: reachText,
        },
        { label: 'Feed writes run', values: pair((sum) => sum.feedWrites), format: count, better: 'lower' },
        {
          label: 'Lookups to serve feed loads',
          values: pair((sum) => sum.lookups),
          format: count,
          better: 'lower',
        },
        {
          label: 'Feed loads that missed the celebrity post',
          values: pair((sum) => sum.missedCelebrity),
          better: 'lower',
        },
      ]
    : [
        { label: 'Feed loads (same for both)', values: pair((sum) => sum.loads), format: count },
        {
          label: `Waited more than ${READ_TARGET_SECONDS} s`,
          values: pair((sum) => sum.slowLoads),
          format: count,
          better: 'lower',
        },
        {
          label: 'Average wait for the read tier',
          values: pair((sum) => sum.averageLoadWaitSeconds),
          format: secondsText,
          better: 'lower',
        },
        {
          label: 'Lookups to serve feed loads',
          values: pair((sum) => sum.lookups),
          format: count,
          better: 'lower',
        },
        { label: 'Feed writes run', values: pair((sum) => sum.feedWrites), format: count, better: 'lower' },
      ];

  const laneText = (lane: FeedLane, index: 0 | 1) => {
    const sum = sums[index];
    return celebrityDuel
      ? `${lane.config.label}: ${sum.missed} posts missed the ${FRESH_SECONDS} s target, ${count(sum.writesWaiting)} feed writes waiting`
      : `${lane.config.label}: ${count(sum.slowLoads)} slow feed loads, ${count(sum.waiting)} waiting`;
  };
  const summary = `${seconds.toFixed(1)} s of ${runSeconds} s. ${shared.text} ${laneText(first, 0)}. ${laneText(second, 1)}.`;
  const latest = (lane: FeedLane) => count(lane.state.series.at(-1) ?? 0);
  const chartSummary = `${text.chart}. ${first.config.label} ${latest(first)}, ${second.config.label} ${latest(second)}.`;

  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);
  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${runSeconds} s` } as const);

  return (
    <SimulationShell
      title={title ?? text.title}
      instructions={instructions ?? text.instructions}
      onTick={onTick}
      onReset={() => restart(scenarioId)}
      summary={summary}
      status={status}
      finished={duel.done}
      resetKey={scenarioId}
      controls={
        <div className="sdv-duel__extra">
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || duel.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <CompareTable
          caption={
            celebrityDuel
              ? 'Whole run so far, same posts and fanout fleet for both'
              : 'Whole run so far, same feed loads and read tier for both'
          }
          columns={[first.config.label, second.config.label]}
          rows={rows}
        />
      }
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: feedScenarios[id].label,
          diff: feedScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <p className="sdv-feedlink" data-tone={shared.tone}>
        <span className="sdv-feedlink__icon" aria-hidden="true">
          {shared.icon}
        </span>
        {shared.text}
      </p>
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane
            key={lane.config.label}
            duel={duel}
            lane={lane}
            sum={sums[index as 0 | 1]}
            variant={variants[index] ?? 'a'}
            celebrityDuel={celebrityDuel}
          />
        ))}
      </div>
      {celebrityDuel ? (
        <>
          <ul className="sdv-qtracks__legend sdv-feedgrid__legend" aria-label="How to read the post grids">
            <LegendTile view="waiting" text={`Waiting for feed writes, inside its ${FRESH_SECONDS} s`} />
            <LegendTile view="onTime" text={`In every follower's feed within ${FRESH_SECONDS} s`} />
            <LegendTile view="overdue" text={`Past ${FRESH_SECONDS} s and still queued`} />
            <LegendTile view="late" text={`Reached every feed after ${FRESH_SECONDS} s`} />
          </ul>
          <ul className="sdv-qtracks__legend sdv-feedq__legend" aria-label="How to read the fanout queues">
            <li>
              <span className="sdv-feedq__item" data-kind="celebrity" aria-hidden="true">
                C
              </span>{' '}
              Celebrity job: {CELEBRITY_BATCH} feed writes
            </li>
            <li>
              <span className="sdv-feedq__item" data-kind="post" aria-hidden="true">
                P
              </span>{' '}
              Ordinary post: {MIN_FOLLOWERS} to {MAX_FOLLOWERS} feed writes
            </li>
          </ul>
        </>
      ) : (
        <ul className="sdv-qtracks__legend sdv-feedq__legend" aria-label="How to read the read queues">
          <li>
            <span className="sdv-feedq__item" data-kind="load" aria-hidden="true">
              45
            </span>{' '}
            A waiting feed load and the lookups it needs
          </li>
        </ul>
      )}
      <TraceChart
        title={text.chart}
        series={duel.lanes.map((lane, index) => ({
          label: lane.config.label,
          values: lane.state.series,
          variant: variants[index] ?? 'a',
        }))}
        length={duel.length}
        tickSeconds={duel.tickSeconds}
        markers={markerEvents.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
        minMax={10}
        summary={chartSummary}
      />
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {markerEvents.length === 0 && notes.length === 0 && (
          <p className="sdv-trace__empty">
            Events appear here, numbered to match the chart, as the run plays.
          </p>
        )}
        {markerEvents.length > 0 && (
          <ol>
            {markerEvents.map((event, index) => (
              <li key={`${event.tick}-${event.text}`}>
                <span className="sdv-trace__num" aria-hidden="true">
                  {index + 1}
                </span>
                <time>{(event.tick * duel.tickSeconds).toFixed(1)} s</time> {event.text}
              </li>
            ))}
          </ol>
        )}
        {notes.map((event) => (
          <p key={`${event.tick}-${event.text}`} className="sdv-trace__note">
            {event.text}
          </p>
        ))}
      </div>
    </SimulationShell>
  );
}
