import { useId, useMemo, useState } from 'react';
import {
  type GeohashAxis,
  type GeohashBox,
  type GeohashStep,
  geohashSteps,
  KM_PER_DEGREE,
} from '../../lib/models/geohash';
import { formatDistance } from '../../lib/models/rideSharing';
import { Segmented, Slider } from '../sim/controls';
import type { Tone } from '../sim/StatTable';
import { useHydrated } from '../sim/useHydrated';
import { WidgetFrame } from '../sim/WidgetFrame';
import { safeId } from '../viz/SystemNode';
import './GeohashExplorerWidget.css';

const CHARACTERS = 6;
const BITS = CHARACTERS * 5;
const WORLD: GeohashBox = { minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 };

type PointId = 'test' | 'north' | 'south';

interface Place {
  lat: number;
  lng: number;
}

interface ExplorerPoint extends Place {
  label: string;
  partner: Place;
  partnerLabel: string;
}

const points: Record<PointId, ExplorerPoint> = {
  test: {
    label: 'Test point',
    lat: 57.64911,
    lng: 10.40744,
    partner: { lat: 57.6495, lng: 10.4078 },
    partnerLabel: 'A point down the street',
  },
  north: {
    label: 'Just north east of 0°, 0°',
    lat: 0.0001,
    lng: 0.0001,
    partner: { lat: -0.0001, lng: -0.0001 },
    partnerLabel: 'Its twin just south west',
  },
  south: {
    label: 'Just south west of 0°, 0°',
    lat: -0.0001,
    lng: -0.0001,
    partner: { lat: 0.0001, lng: 0.0001 },
    partnerLabel: 'Its twin just north east',
  },
};

const pointOptions: { value: PointId; label: string }[] = [
  { value: 'test', label: 'Test point' },
  { value: 'north', label: 'North east of 0°, 0°' },
  { value: 'south', label: 'South west of 0°, 0°' },
];

function distanceKm(a: Place, b: Place): number {
  const meanLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  return Math.hypot((a.lat - b.lat) * KM_PER_DEGREE, (a.lng - b.lng) * KM_PER_DEGREE * Math.cos(meanLat));
}

function hashSoFar(steps: GeohashStep[], count: number) {
  const chosen = steps.slice(0, count);
  const chars = chosen.map((step) => step.char ?? '').join('');
  const pending = chosen
    .slice(chars.length * 5)
    .map((step) => step.value)
    .join('');
  return { chars, pending };
}

function hashLabel({ chars, pending }: { chars: string; pending: string }): string {
  if (chars === '') return pending === '' ? 'none yet' : `bits ${pending}`;
  return pending === '' ? chars : `${chars} + bits ${pending}`;
}

function sharedBits(a: GeohashStep[], b: GeohashStep[], count: number): number {
  let shared = 0;
  while (shared < count && a[shared]?.value === b[shared]?.value) shared += 1;
  return shared;
}

function halfWord(axis: GeohashAxis, value: 0 | 1): string {
  if (axis === 'lng') return value === 1 ? 'east' : 'west';
  return value === 1 ? 'north' : 'south';
}

const plural = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`;

function formatSize(km: number): string {
  return km >= 10 ? `${Math.round(km).toLocaleString('en-US')} km` : formatDistance(km);
}

function formatDegrees(value: number, span: number): string {
  const decimals = Math.min(6, Math.max(0, Math.ceil(-Math.log10(span)) + 2));
  return `${value.toFixed(decimals)}°`;
}

const VIEW_W = 320;
const VIEW_H = 210;
const AREA_TOP = 28;
const AREA_W = 280;
const AREA_H = 150;

interface HalvingProps {
  parent: GeohashBox;
  step: GeohashStep;
  point: Place;
  bitNumber: number;
}

/** One halving, drawn in degrees: the box before this bit, the split line, and the half the point falls in. */
function HalvingView({ parent, step, point, bitNumber }: HalvingProps) {
  const hatchId = safeId(useId(), 'geo-hatch');
  const widthDeg = parent.maxLng - parent.minLng;
  const heightDeg = parent.maxLat - parent.minLat;
  const scale = Math.min(AREA_W / widthDeg, AREA_H / heightDeg);
  const width = widthDeg * scale;
  const height = heightDeg * scale;
  const left = (VIEW_W - width) / 2;
  const top = AREA_TOP + (AREA_H - height) / 2;
  const toX = (lng: number) => left + (lng - parent.minLng) * scale;
  const toY = (lat: number) => top + (parent.maxLat - lat) * scale;
  const isLng = step.axis === 'lng';
  const mid = isLng ? (parent.minLng + parent.maxLng) / 2 : (parent.minLat + parent.maxLat) / 2;
  const splitX = toX(isLng ? mid : parent.minLng);
  const splitY = toY(isLng ? parent.maxLat : mid);

  const halves = isLng
    ? [
        { value: 0 as const, x: left, y: top, w: width / 2, h: height },
        { value: 1 as const, x: splitX, y: top, w: width / 2, h: height },
      ]
    : [
        { value: 1 as const, x: left, y: top, w: width, h: height / 2 },
        { value: 0 as const, x: left, y: splitY, w: width, h: height / 2 },
      ];
  const pointX = toX(Math.min(parent.maxLng, Math.max(parent.minLng, point.lng)));
  const pointY = toY(Math.min(parent.maxLat, Math.max(parent.minLat, point.lat)));
  const axisWord = isLng ? 'longitude' : 'latitude';
  const label = `Bit ${bitNumber} splits a box ${formatDegrees(widthDeg, widthDeg)} wide and ${formatDegrees(heightDeg, heightDeg)} tall at ${axisWord} ${formatDegrees(mid, isLng ? widthDeg : heightDeg)}. The point sits in the ${halfWord(step.axis, step.value)} half, so the bit is ${step.value}.`;

  return (
    <figure className="sdv-geo__figure">
      <svg className="sdv-geo__map" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={label}>
        <defs>
          <pattern
            id={hatchId}
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="4" y1="0" x2="4" y2="8" className="sdv-geo__hatch-line" />
          </pattern>
        </defs>
        <text x={VIEW_W / 2} y={16} className="sdv-geo__title" textAnchor="middle">
          Bit {bitNumber} halves {axisWord}
        </text>
        {halves.map((half) => {
          const kept = half.value === step.value;
          const word = halfWord(step.axis, half.value);
          return (
            <g key={word}>
              <rect
                x={half.x}
                y={half.y}
                width={half.w}
                height={half.h}
                className={kept ? 'sdv-geo__half sdv-geo__half--kept' : 'sdv-geo__half'}
              />
              {kept && (
                <rect x={half.x} y={half.y} width={half.w} height={half.h} fill={`url(#${hatchId})`} />
              )}
              <text
                x={half.x + half.w / 2}
                y={half.y + half.h / 2 - 2}
                className="sdv-geo__digit"
                textAnchor="middle"
              >
                {half.value}
              </text>
              <text
                x={half.x + half.w / 2}
                y={half.y + half.h / 2 + 16}
                className="sdv-geo__word"
                textAnchor="middle"
              >
                {kept ? `${word}, kept` : word}
              </text>
            </g>
          );
        })}
        {isLng ? (
          <line x1={splitX} y1={top} x2={splitX} y2={top + height} className="sdv-geo__split" />
        ) : (
          <line x1={left} y1={splitY} x2={left + width} y2={splitY} className="sdv-geo__split" />
        )}
        {isLng ? (
          <text x={splitX} y={top + height + 16} className="sdv-geo__mid" textAnchor="middle">
            {formatDegrees(mid, widthDeg)}
          </text>
        ) : (
          <text x={left + width + 4} y={splitY + 4} className="sdv-geo__mid">
            {formatDegrees(mid, heightDeg)}
          </text>
        )}
        <circle cx={pointX} cy={pointY} r={7} className="sdv-geo__point-ring" />
        <circle cx={pointX} cy={pointY} r={3.5} className="sdv-geo__point" />
      </svg>
      <figcaption className="sdv-geo__caption">
        Drawn in degrees, the units the algorithm halves. Each step zooms into the half that holds the point.
      </figcaption>
    </figure>
  );
}

function BitStrip({ steps, count }: { steps: GeohashStep[]; count: number }) {
  const groups = Array.from({ length: CHARACTERS }, (_, index) => steps.slice(index * 5, index * 5 + 5));
  return (
    <div className="sdv-geo__strip">
      <ol className="sdv-geo__groups" aria-label="Bits grouped into base32 characters">
        {groups.map((group, groupIndex) => {
          const first = groupIndex * 5;
          const done = count >= first + 5;
          const value = group.reduce((total, step) => total * 2 + step.value, 0);
          const char = group[4]?.char ?? '';
          return (
            <li key={first} className="sdv-geo__group" data-done={done ? 'true' : undefined}>
              <span className="sdv-geo__bits">
                {group.map((step) => {
                  const chosen = step.bit < count;
                  return (
                    <span
                      key={step.bit}
                      className="sdv-geo__bit"
                      data-axis={step.axis}
                      data-current={step.bit === count - 1 ? 'true' : undefined}
                      data-pending={chosen ? undefined : 'true'}
                    >
                      <span className="sdv-geo__bit-value">
                        {chosen ? step.value : <span aria-hidden="true">·</span>}
                      </span>
                      {!chosen && <span className="sdv-visually-hidden">not chosen,</span>}
                      <span className="sdv-geo__bit-axis" aria-hidden="true">
                        {step.axis === 'lng' ? '↔' : '↕'}
                      </span>
                      <span className="sdv-visually-hidden">
                        {step.axis === 'lng' ? 'longitude' : 'latitude'}
                      </span>
                    </span>
                  );
                })}
              </span>
              <span className="sdv-geo__char">
                {done ? (
                  <>
                    {value} → <code>{char}</code>
                  </>
                ) : (
                  <>
                    <span aria-hidden="true">?</span>
                    <span className="sdv-visually-hidden">character not chosen yet</span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="sdv-geo__legend">
        <span aria-hidden="true">↔</span> longitude bit, <span aria-hidden="true">↕</span> latitude bit. Five
        bits read as a number from 0 to 31 pick one character of <code>0123456789bcdefghjkmnpqrstuvwxyz</code>
        .
      </p>
    </div>
  );
}

interface Props {
  initialPoint?: PointId;
  initialBits?: number;
}

/** Replay geohash encoding one bit at a time: each bit halves the box, alternating longitude and latitude. */
export default function GeohashExplorerWidget({ initialPoint = 'test', initialBits = 5 }: Props) {
  const hydrated = useHydrated();
  const [pointId, setPointId] = useState<PointId>(initialPoint);
  const [count, setCount] = useState(Math.min(BITS, Math.max(1, initialBits)));
  const point = points[pointId];
  const steps = useMemo(() => geohashSteps(point.lat, point.lng, CHARACTERS), [point]);
  const partnerSteps = useMemo(() => geohashSteps(point.partner.lat, point.partner.lng, CHARACTERS), [point]);

  const step = steps[count - 1];
  if (!step) return null;
  const parent = steps[count - 2]?.box ?? WORLD;
  const box = step.box;
  const own = hashSoFar(steps, count);
  const partner = hashSoFar(partnerSteps, count);
  const shared = sharedBits(steps, partnerSteps, count);
  const apart = formatDistance(distanceKm(point, point.partner));
  const widthKm = (box.maxLng - box.minLng) * KM_PER_DEGREE * Math.cos((point.lat * Math.PI) / 180);
  const heightKm = (box.maxLat - box.minLat) * KM_PER_DEGREE;
  const size = `about ${formatSize(widthKm)} × ${formatSize(heightKm)}`;
  const next = steps[count];
  const axisWord = step.axis === 'lng' ? 'longitude' : 'latitude';
  const split = shared < count;

  const status: { tone: Tone; text: string } = split
    ? { tone: 'warn', text: `Split from a point ${apart} away` }
    : { tone: 'ok', text: `Same cell as a point ${apart} away` };

  const summary = `${point.label}, bit ${count} of ${BITS}: it halves ${axisWord} and the point keeps the ${halfWord(step.axis, step.value)} half, so the bit is ${step.value}. Hash so far: ${hashLabel(own)}. The cell is now ${size}. ${point.partnerLabel}, ${apart} away, shares the first ${shared} of ${count} bits.`;

  const goTo = (bits: number) => setCount(Math.min(BITS, Math.max(1, bits)));

  return (
    <WidgetFrame
      title="Geohash explorer"
      instructions="Step through the bits. Each bit halves the box that holds the point, alternating longitude and latitude, and every 5 bits become one character. Switch points to see two places 31 m apart that share no prefix at all."
      summary={summary}
      status={status}
      stats={[
        {
          label: 'Hash so far',
          value: hashLabel(own),
          detail:
            own.pending === ''
              ? plural(own.chars.length, 'character')
              : `${plural(5 - own.pending.length, 'more bit')} to finish the next character`,
        },
        {
          label: 'Bits chosen',
          value: `${count} of ${BITS}`,
          detail: next
            ? `next bit halves ${next.axis === 'lng' ? 'longitude' : 'latitude'}`
            : 'six characters',
        },
        {
          label: 'Cell size now',
          value: size,
          detail: 'approximate; width shrinks toward the poles',
        },
        {
          label: point.partnerLabel,
          value: hashLabel(partner),
          detail: `${apart} away, shares the first ${shared} of ${count} bits`,
          tone: split ? 'warn' : 'ok',
        },
      ]}
      actions={
        <>
          <button
            type="button"
            className="sdv-button"
            disabled={!hydrated || count <= 1}
            onClick={() => goTo(count - 1)}
          >
            Previous bit
          </button>
          <button
            type="button"
            className="sdv-button"
            disabled={!hydrated || count >= BITS}
            onClick={() => goTo(count + 1)}
          >
            Next bit
          </button>
          <button
            type="button"
            className="sdv-button"
            disabled={!hydrated || count >= BITS}
            onClick={() => goTo(Math.floor(count / 5) * 5 + 5)}
          >
            Next character
          </button>
        </>
      }
      controls={
        <>
          <Segmented label="Point to encode" value={pointId} options={pointOptions} onChange={setPointId} />
          <Slider
            label="Bits chosen"
            value={count}
            min={1}
            max={BITS}
            onChange={goTo}
            format={(value) => `${plural(value, 'bit')}, ${plural(Math.floor(value / 5), 'character')}`}
            hint="Every 5 bits make one base32 character; 30 bits make the 6 character cells in the city map."
          />
        </>
      }
    >
      <div className="sdv-geo">
        <HalvingView parent={parent} step={step} point={point} bitNumber={count} />
        <BitStrip steps={steps} count={count} />
      </div>
    </WidgetFrame>
  );
}
