import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/failover';
import { lerp, link, type Positioned, type Vec } from '../../viz/geometry';
import { Edge, SystemNode } from '../../viz/SystemNode';
import { type ConceptScene, Dot, Marker, Note, SceneFrame, type SceneProps, Show, Still } from '../parts';
import variants from '../variants/failover';

const L = labelReader(entry.labels);
const FAILOVER_HEIGHT = 260;

const APP_H = 58;
const DB_W = 116;
const DB_H = 64;
const app: Positioned = { x: 160, y: 36, w: 96, h: APP_H };
const FAIL_AT = 0.4;
const PROMOTE_AT = 0.6;

function App({ thumb }: { thumb?: boolean }) {
  return (
    <SystemNode
      kind="client"
      x={app.x}
      y={app.y}
      width={app.w}
      height={APP_H}
      label={thumb ? '' : L('app')}
    />
  );
}

function Database({
  at,
  label,
  status,
  leader,
}: {
  at: Positioned;
  label: string;
  status?: 'bad';
  leader?: boolean;
}) {
  return (
    <SystemNode
      kind="database"
      x={at.x}
      y={at.y}
      width={DB_W}
      height={DB_H}
      label={label}
      status={status}
      role={leader ? 'leader' : undefined}
    />
  );
}

function trips(leg: { from: Vec; to: Vec }, starts: number[], replyTone?: 'bad') {
  return starts.flatMap((s) => [
    <Dot key={`q${s}`} path={[leg.from, leg.to]} at={[s, s + 0.07]} />,
    <Dot key={`r${s}`} path={[leg.to, leg.from]} at={[s + 0.07, s + 0.14]} response tone={replyTone} />,
  ]);
}

/** One primary takes every request; once it fails, every request fails with it. */
function FailoverWithout({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const primary: Positioned = { x: 160, y: 190, w: DB_W, h: DB_H };
  const leg = link(app, primary);
  const name = thumb ? '' : L('primary');
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={FAILOVER_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Edge {...leg} marker={marker} />
          <App thumb={thumb} />
          <Show at={[0, FAIL_AT]}>
            <Database at={primary} label={name} />
          </Show>
          <Show at={[FAIL_AT, 1]}>
            <Database at={primary} label={name} status="bad" />
          </Show>
          {trips(leg, [0.02, 0.18])}
          {trips(leg, [0.46, 0.62, 0.78], 'bad')}
          <Still at={lerp(leg.from, leg.to, 0.35)} />
          <Still at={lerp(leg.from, leg.to, 0.7)} response tone="bad" />
          <Marker n={1} x={196} y={100} at={0} thumb={thumb} />
          <Marker n={2} x={250} y={190} at={FAIL_AT} thumb={thumb} />
          <Marker n={3} x={124} y={124} at={0.5} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

/** A heartbeat stops when the primary fails, so the standby is promoted and requests follow it. */
function FailoverWith({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const primary: Positioned = { x: 76, y: 190, w: DB_W, h: DB_H };
  const standby: Positioned = { x: 244, y: 190, w: DB_W, h: DB_H };
  const toPrimary = link(app, primary);
  const toStandby = link(app, standby);
  const beat = link(primary, standby);
  const label = (key: string) => (thumb ? '' : L(key));
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={FAILOVER_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Show at={[0, PROMOTE_AT]}>
            <Edge {...toPrimary} marker={marker} />
            <g className="sdv-concept__cut">
              <Edge {...toStandby} dashed />
            </g>
          </Show>
          <Show at={[PROMOTE_AT, 1]}>
            <g className="sdv-concept__cut">
              <Edge {...toPrimary} dashed />
            </g>
            <Edge {...toStandby} marker={marker} />
          </Show>
          <Show at={[0, FAIL_AT]}>
            <Edge {...beat} marker={marker} dashed />
          </Show>
          <Show at={[FAIL_AT, 1]}>
            <g className="sdv-concept__cut">
              <Edge {...beat} dashed />
            </g>
          </Show>
          <Note x={160} y={150} text={L('heartbeat')} thumb={thumb} />
          <App thumb={thumb} />
          <Show at={[0, FAIL_AT]}>
            <Database at={primary} label={label('primary')} />
          </Show>
          <Show at={[FAIL_AT, 1]}>
            <Database at={primary} label={label('primary')} status="bad" />
          </Show>
          <Show at={[0, PROMOTE_AT]}>
            <Database at={standby} label={label('standby')} />
          </Show>
          <Show at={[PROMOTE_AT, 1]}>
            <Database at={standby} label={label('promoted')} leader />
          </Show>
          {trips(toPrimary, [0.02, 0.2])}
          {[0.04, 0.14, 0.24, 0.34].map((s) => (
            <Dot key={`b${s}`} path={[beat.from, beat.to]} at={[s, s + 0.05]} tone="hit" />
          ))}
          <Dot path={[toPrimary.from, toPrimary.to]} at={[0.44, 0.51]} />
          <Dot path={[toPrimary.to, toPrimary.from]} at={[0.51, 0.58]} response tone="bad" />
          {trips(toStandby, [0.64, 0.8])}
          <Still at={lerp(toStandby.from, toStandby.to, 0.35)} />
          <Still at={lerp(toStandby.from, toStandby.to, 0.7)} response />
          <Marker n={1} x={160} y={216} at={0} thumb={thumb} />
          <Marker n={2} x={76} y={244} at={FAIL_AT} thumb={thumb} />
          <Marker n={3} x={266} y={100} at={PROMOTE_AT} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: FailoverWithout, with: FailoverWith, variants } satisfies ConceptScene;
