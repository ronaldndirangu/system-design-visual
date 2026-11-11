import { useReducer, useRef, useState } from 'react';
import {
  ChatDuel,
  type ChatDuelId,
  type ChatLane,
  type ChatScenarioId,
  type ChatSummary,
  chatScenarios,
  duelScenarioIds,
  GRID_COLS,
  MESSAGES,
  missingAbove,
  screenTail,
  summarize,
  type TileView,
  tileView,
} from '../../lib/models/chat';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import './ChatWidget.css';

interface Props {
  duel: ChatDuelId;
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];
const messageIds = Array.from({ length: MESSAGES }, (_, id) => id);
const secondsText = (value: number) => `${value.toFixed(1)} s`;

const glyphs: Record<TileView, string> = {
  future: '',
  flight: '',
  queued: '≡',
  held: '‖',
  shown: '✓',
  late: '↓',
  lost: '✕',
  recovered: '↺',
};

const copy: Record<ChatDuelId, { title: string; instructions: string; chart: string }> = {
  ordering: {
    title: 'Same conversation, two ways to show it',
    instructions:
      'Pick a scenario, then press Play. Both lanes get the same 96 messages over the same push workers with the same stalls. Only the phone differs: one shows each message the moment it lands, the other waits for the next sequence number.',
    chart: 'Messages shown out of order',
  },
  sync: {
    title: 'Same tunnel, two ways to catch up',
    instructions:
      'Pick a scenario, then press Play. Both lanes get the same 96 messages and lose signal at the same moment. Only the reconnect differs: one waits for the server to send what it queued, the other asks for everything after the last message it showed.',
    chart: 'Messages missing from the phone',
  },
};

type Link = { tone: 'ok' | 'warn' | 'bad'; icon: string; text: string };

/** What the phone and the server believe about the connection after the last tick that ran. */
function linkState(duel: ChatDuel): Link {
  const tick = duel.ticks - 1;
  if (duel.offTick < 0 || tick < duel.offTick) {
    return {
      tone: 'ok',
      icon: '✓',
      text: 'Phone connected. The server pushes each message down its socket.',
    };
  }
  if (tick >= duel.onTick) {
    return { tone: 'ok', icon: '✓', text: 'Phone back online on a new socket.' };
  }
  if (duel.detectTick >= 0 && tick >= duel.detectTick) {
    return {
      tone: 'warn',
      icon: '≡',
      text: 'No signal. The server marked the phone offline and queues new messages.',
    };
  }
  return {
    tone: 'bad',
    icon: '✕',
    text: 'No signal. The server has not noticed and keeps pushing into the dead socket.',
  };
}

function MessageGrid({ lane }: { lane: ChatLane }) {
  return (
    <div
      className="sdv-chatgrid"
      aria-hidden="true"
      style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}
    >
      {messageIds.map((id) => {
        const view = tileView(lane, id);
        return (
          <span key={id} className="sdv-chattile" data-view={view}>
            {glyphs[view]}
          </span>
        );
      })}
    </div>
  );
}

function gapText({ first, last }: { first: number; last: number }): string {
  const missing = first === last ? `Message ${first + 1}` : `Messages ${first + 1} to ${last + 1}`;
  return `Simulation note: ${missing} never arrived. This lane never checks for gaps.`;
}

function PhoneScreen({ lane }: { lane: ChatLane }) {
  const tail = screenTail(lane);
  const gaps = missingAbove(lane);
  return (
    <div className="sdv-chatphone">
      <p className="sdv-chatphone__title">Phone screen, newest at the bottom</p>
      {gaps.map((gap) => (
        <p key={gap.first} className="sdv-chatphone__gap">
          <span aria-hidden="true">⚠</span> {gapText(gap)}
        </p>
      ))}
      {tail.length === 0 ? (
        <p className="sdv-chatphone__empty">No messages yet.</p>
      ) : (
        <ol className="sdv-chatphone__list">
          {tail.map((entry) => (
            <li key={entry.id} className="sdv-chatphone__bubble" data-flag={entry.flag}>
              <span>Message {entry.id + 1}</span>
              {entry.flag === 'late' && (
                <span className="sdv-chatphone__flag">
                  <span aria-hidden="true">↓</span> Out of order: it belongs higher up
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function LanePane({
  lane,
  sum,
  variant,
  orderingDuel,
}: {
  lane: ChatLane;
  sum: ChatSummary;
  variant: SeriesVariant;
  orderingDuel: boolean;
}) {
  const parts = [`${sum.shown} shown`, `${sum.inFlight} on the way`];
  if (lane.config.reorderBuffer) parts.push(`${sum.held} held in the buffer`);
  if (!orderingDuel) parts.push(`${sum.queued} queued on the server`);
  return (
    <section className="sdv-duel__lane" aria-label={lane.config.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.config.label}
      </h4>
      <MessageGrid lane={lane} />
      <div className="sdv-chatgrid__tally">
        <p>Messages: {parts.join(', ')}.</p>
        {orderingDuel ? (
          <p>Shown out of order: {sum.outOfOrder}.</p>
        ) : (
          <p>
            Missing from the phone: {sum.lost}
            {lane.config.catchUp ? `, recovered by the catch-up: ${sum.recovered}` : ''}.
          </p>
        )}
        {lane.config.reorderBuffer && sum.held > 0 && (
          <p>Buffer waits for message {lane.state.nextExpected + 1}.</p>
        )}
      </div>
      <PhoneScreen lane={lane} />
    </section>
  );
}

export default function ChatWidget({ duel: duelId, title, instructions }: Props) {
  const hydrated = useHydrated();
  const scenarios = duelScenarioIds[duelId];
  const [scenarioId, setScenarioId] = useState<ChatScenarioId>(scenarios[0] ?? 'busy-group');
  const duelRef = useRef<ChatDuel | null>(null);
  if (!duelRef.current) duelRef.current = new ChatDuel(chatScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: ChatScenarioId) => {
    duelRef.current = new ChatDuel(chatScenarios[id]);
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
  const chooseScenario = (id: ChatScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const orderingDuel = duelId === 'ordering';
  const [first, second] = duel.lanes;
  const sums = [summarize(first, duel.messages), summarize(second, duel.messages)] as const;
  const seconds = duel.ticks * duel.tickSeconds;
  const runSeconds = duel.scenario.seconds;
  const text = copy[duelId];
  const link = orderingDuel ? null : linkState(duel);

  const rows: CompareRow[] = orderingDuel
    ? [
        { label: 'Messages sent (same conversation)', values: [sums[0].sent, sums[1].sent] },
        { label: 'Shown on the phone', values: [sums[0].shown, sums[1].shown] },
        { label: 'Shown out of order', values: [sums[0].outOfOrder, sums[1].outOfOrder], better: 'lower' },
        { label: 'Held back by the reorder buffer', values: [sums[0].heldBack, sums[1].heldBack] },
        {
          label: 'Longest hold in the buffer',
          values: [sums[0].longestHoldSeconds, sums[1].longestHoldSeconds],
          format: secondsText,
        },
        {
          label: 'Average delay, server to screen',
          values: [sums[0].averageDelaySeconds, sums[1].averageDelaySeconds],
          format: secondsText,
          better: 'lower',
        },
      ]
    : [
        { label: 'Messages sent (same conversation)', values: [sums[0].sent, sums[1].sent] },
        { label: 'Shown on the phone', values: [sums[0].shown, sums[1].shown], better: 'higher' },
        { label: 'Missing from the phone', values: [sums[0].lost, sums[1].lost], better: 'lower' },
        { label: 'Recovered by the catch-up', values: [sums[0].recovered, sums[1].recovered] },
        { label: 'Queued on the server now', values: [sums[0].queued, sums[1].queued] },
        {
          label: 'Average delay, server to screen',
          values: [sums[0].averageDelaySeconds, sums[1].averageDelaySeconds],
          format: secondsText,
          better: 'lower',
        },
      ];

  const laneText = (lane: ChatLane, index: 0 | 1) => {
    const sum = sums[index];
    return orderingDuel
      ? `${lane.config.label}: ${sum.shown} shown, ${sum.outOfOrder} out of order`
      : `${lane.config.label}: ${sum.shown} shown, ${sum.lost} missing`;
  };
  const summary = `${seconds.toFixed(1)} s of ${runSeconds} s. ${link ? `${link.text} ` : ''}${laneText(first, 0)}. ${laneText(second, 1)}.`;
  const latest = (lane: ChatLane) => lane.state.series.at(-1) ?? 0;
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
          caption="Whole run so far, same messages and network for both"
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
          label: chatScenarios[id].label,
          diff: chatScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      {link && (
        <p className="sdv-chatlink" data-tone={link.tone}>
          <span className="sdv-chatlink__icon" aria-hidden="true">
            {link.icon}
          </span>
          {link.text}
        </p>
      )}
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane
            key={lane.config.label}
            lane={lane}
            sum={sums[index as 0 | 1]}
            variant={variants[index] ?? 'a'}
            orderingDuel={orderingDuel}
          />
        ))}
      </div>
      <ul className="sdv-qtracks__legend sdv-chatgrid__legend" aria-label="How to read the message grids">
        <li>
          <span className="sdv-chattile" data-view="flight" aria-hidden="true" /> On its way to the phone
        </li>
        {orderingDuel ? (
          <li>
            <span className="sdv-chattile" data-view="held" aria-hidden="true">
              {glyphs.held}
            </span>{' '}
            On the phone, held until the gap fills
          </li>
        ) : (
          <li>
            <span className="sdv-chattile" data-view="queued" aria-hidden="true">
              {glyphs.queued}
            </span>{' '}
            Queued on the server while the phone is offline
          </li>
        )}
        <li>
          <span className="sdv-chattile" data-view="shown" aria-hidden="true">
            {glyphs.shown}
          </span>{' '}
          Shown in order
        </li>
        {orderingDuel ? (
          <li>
            <span className="sdv-chattile" data-view="late" aria-hidden="true">
              {glyphs.late}
            </span>{' '}
            Shown below a newer message
          </li>
        ) : (
          <>
            <li>
              <span className="sdv-chattile" data-view="lost" aria-hidden="true">
                {glyphs.lost}
              </span>{' '}
              Lost in the dead socket
            </li>
            <li>
              <span className="sdv-chattile" data-view="recovered" aria-hidden="true">
                {glyphs.recovered}
              </span>{' '}
              Lost, then replayed by the catch-up
            </li>
          </>
        )}
      </ul>
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
