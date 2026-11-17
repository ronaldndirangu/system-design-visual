import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/retries';
import { lerp, link, type Positioned, type Vec } from '../../viz/geometry';
import { Edge, SystemNode } from '../../viz/SystemNode';
import { type ConceptScene, Dot, Marker, Note, SceneFrame, type SceneProps, Show, Still } from '../parts';
import variants from '../variants/retries';

const L = labelReader(entry.labels);
const RETRIES_HEIGHT = 200;

const NODE_H = 58;
const apps: Positioned = { x: 60, y: 46, w: 96, h: NODE_H };
const service: Positioned = { x: 258, y: 46, w: 104, h: NODE_H };
const leg = link(apps, service);
const LANE_GAP = 6;

/** Timeline: seconds map to x, and to a fraction of the animation loop. */
const T_X0 = 56;
const PX_PER_S = 16;
const TIMEOUT_S = 2;
const BAR_H = 16;
const ROWS = { a: 126, b: 160 } as const;
type Row = keyof typeof ROWS;

const secondsX = (s: number) => T_X0 + s * PX_PER_S;
const loopAt = (s: number) => 0.05 + s * 0.0567;

interface Try {
  start: number;
  ok?: boolean;
}

function lane(row: Row): { from: Vec; to: Vec } {
  const dy = row === 'a' ? -LANE_GAP : LANE_GAP;
  return { from: [leg.from[0], leg.from[1] + dy], to: [leg.to[0], leg.to[1] + dy] };
}

function Service({ thumb, status }: { thumb?: boolean; status: 'ok' | 'warn' | 'bad' }) {
  return (
    <SystemNode
      kind="server"
      x={service.x}
      y={service.y}
      width={service.w}
      height={NODE_H}
      label={thumb ? '' : L('service')}
      status={status}
    />
  );
}

/** Each try draws as an empty slot while it waits, then fills red on timeout or green on success. */
function Tries({ row, tries, thumb }: { row: Row; tries: Try[]; thumb?: boolean }) {
  const y = ROWS[row];
  const path = lane(row);
  return (
    <g>
      <Note x={T_X0 - 8} y={y + BAR_H / 2 + 5} text={L(row)} thumb={thumb} anchor="end" />
      {tries.map(({ start, ok }) => {
        const end = start + TIMEOUT_S;
        const x = secondsX(start) + 1;
        const width = TIMEOUT_S * PX_PER_S - 2;
        return (
          <g key={start}>
            <Show at={[loopAt(start), 1]}>
              <rect className="sdv-concept__gauge-frame" x={x} y={y} width={width} height={BAR_H} rx={3} />
            </Show>
            <Show at={[loopAt(end), 1]}>
              <rect
                className={ok ? 'sdv-concept__fill--ok' : 'sdv-concept__fill--bad'}
                x={x}
                y={y}
                width={width}
                height={BAR_H}
                rx={3}
              />
            </Show>
            <Dot path={[path.from, path.to]} at={[loopAt(start), loopAt(start) + 0.04]} />
            {ok && (
              <Dot path={[path.to, path.from]} at={[loopAt(end) - 0.04, loopAt(end)]} response tone="hit" />
            )}
          </g>
        );
      })}
    </g>
  );
}

function Frame({ thumb, marker }: { thumb?: boolean; marker: string }) {
  return (
    <>
      <Edge {...leg} marker={marker} />
      <Edge from={[T_X0, 190]} to={[secondsX(15.6), 190]} marker={marker} />
      <SystemNode
        kind="client"
        x={apps.x}
        y={apps.y}
        width={apps.w}
        height={NODE_H}
        label={thumb ? '' : L('apps')}
      />
    </>
  );
}

/** Both apps retry the instant a try times out, in step, so the service never gets a break. */
function RetriesWithout({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const tries: Try[] = [0, 2, 4, 6, 8, 10, 12].map((start) => ({ start }));
  const a = lane('a');
  const b = lane('b');
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={RETRIES_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Frame thumb={thumb} marker={marker} />
          <Show at={[0, 0.3]}>
            <Service thumb={thumb} status="warn" />
          </Show>
          <Show at={[0.3, 1]}>
            <Service thumb={thumb} status="bad" />
          </Show>
          <Tries row="a" tries={tries} thumb={thumb} />
          <Tries row="b" tries={tries} thumb={thumb} />
          <Still at={lerp(a.from, a.to, 0.55)} />
          <Still at={lerp(b.from, b.to, 0.55)} />
          <Marker n={1} x={64} y={106} at={0} thumb={thumb} />
          <Marker n={2} x={304} y={151} at={0.2} thumb={thumb} />
          <Marker n={3} x={258} y={100} at={0.3} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

/** Pauses double after each timeout, and jitter shifts App B's tries, so the service recovers. */
function RetriesWith({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const triesA: Try[] = [{ start: 0 }, { start: 3 }, { start: 7 }, { start: 13, ok: true }];
  const triesB: Try[] = [{ start: 0 }, { start: 2.5 }, { start: 6 }, { start: 11, ok: true }];
  const pauses: { key: string; from: number; to: number }[] = [
    { key: 'w1', from: 2, to: 3 },
    { key: 'w2', from: 5, to: 7 },
    { key: 'w4', from: 9, to: 13 },
  ];
  const recovered = loopAt(11);
  const a = lane('a');
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={RETRIES_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Frame thumb={thumb} marker={marker} />
          <Show at={[0, recovered]}>
            <Service thumb={thumb} status="warn" />
          </Show>
          <Show at={[recovered, 1]}>
            <Service thumb={thumb} status="ok" />
          </Show>
          {pauses.map(({ key, from, to }) => (
            <Show key={key} at={[loopAt(from), 1]}>
              <Note x={secondsX((from + to) / 2)} y={116} text={L(key)} thumb={thumb} />
            </Show>
          ))}
          <Tries row="a" tries={triesA} thumb={thumb} />
          <Tries row="b" tries={triesB} thumb={thumb} />
          <Still at={lerp(a.from, a.to, 0.5)} response tone="hit" />
          <Marker n={1} x={64} y={104} at={0} thumb={thumb} />
          <Marker n={2} x={192} y={106} at={loopAt(2)} thumb={thumb} />
          <Marker n={3} x={284} y={168} at={loopAt(6)} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: RetriesWithout, with: RetriesWith, variants } satisfies ConceptScene;
