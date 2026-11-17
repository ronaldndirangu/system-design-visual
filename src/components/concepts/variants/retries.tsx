import { Arrow, Divider, Label } from '../miniParts';
import type { VariantDrawing } from '../parts';

const TRY_W = 6;

/** Tries along a time axis; `ok` marks the last try as the one that worked. */
function triesPanel(ox: number, label: string, starts: number[], marker: string, ok = false) {
  return (
    <g>
      <Label x={ox + 50} y={16} text={label} />
      {starts.map((x, i) => (
        <rect
          key={x}
          className={ok && i === starts.length - 1 ? 'sdv-concept__fill--ok' : 'sdv-concept__fill--bad'}
          x={ox + x}
          y={44}
          width={TRY_W}
          height={26}
          rx={2}
        />
      ))}
      <Arrow from={[ox + 4, 86]} to={[ox + 96, 86]} marker={marker} />
    </g>
  );
}

/** Three apps, one row each; every row lists its try start times. */
function rowsPanel(ox: number, label: string, rows: number[][], marker: string) {
  return (
    <g>
      <Label x={ox + 50} y={16} text={label} />
      {rows.flatMap((starts, r) => {
        const y = 32 + r * 22;
        return starts.map((x) => (
          <rect key={`${x},${y}`} className="sdv-dot" x={ox + x} y={y} width={10} height={12} rx={2} />
        ));
      })}
      <Arrow from={[ox + 4, 106]} to={[ox + 96, 106]} marker={marker} />
    </g>
  );
}

const variants: VariantDrawing[] = [
  (marker, labels) => (
    <>
      {triesPanel(0, labels('fixed'), [4, 16, 28, 40, 52, 64, 76], marker)}
      <Divider />
      {triesPanel(100, labels('doubling'), [4, 14, 28, 50, 88], marker, true)}
    </>
  ),
  (marker, labels) => (
    <>
      {rowsPanel(
        0,
        labels('lockstep'),
        [
          [6, 26, 58],
          [6, 26, 58],
          [6, 26, 58],
        ],
        marker,
      )}
      <Divider />
      {rowsPanel(
        100,
        labels('jitter'),
        [
          [4, 22, 56],
          [12, 34, 70],
          [8, 46, 82],
        ],
        marker,
      )}
    </>
  ),
];

export default variants;
