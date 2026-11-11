import { m } from 'motion/react';
import { useId, useMemo, useRef, useState } from 'react';
import { logFraction, logRange, logTicks } from '../../lib/logAxis';
import {
  type EstimateInputs,
  estimate,
  formatBytes,
  formatCount,
  type PresetId,
  presets,
  TARGET_UTILIZATION,
} from '../../lib/models/estimates';
import { Segmented, Slider } from '../sim/controls';
import { MotionRoot } from '../sim/MotionRoot';
import { useElementWidth } from '../sim/useElementWidth';
import { useHydrated } from '../sim/useHydrated';
import { WidgetFrame } from '../sim/WidgetFrame';

type Choice = PresetId | 'custom';

const presetOptions = (Object.keys(presets) as PresetId[]).map((id) => ({
  value: id,
  label: presets[id].label,
}));

const FALLBACK_WIDTH = 520;
// Below this chart width the lane names move above their bars so the bars keep most of the width.
const STACK_BELOW = 440;
const BAR_HEIGHT = 20;
const LIMIT_LABEL_HALF_WIDTH = 90;
const SERVER_ICONS_SHOWN = 48;
const SAMPLE_CODE = 'aZ3k9QxP2mT';

interface ChartLayout {
  stacked: boolean;
  left: number;
  right: number;
  top: number;
  lane: number;
  labelY: number;
  barY: number;
}

function chartLayout(width: number): ChartLayout {
  return width < STACK_BELOW
    ? { stacked: true, left: 20, right: width - 20, top: 30, lane: 50, labelY: 14, barY: 22 }
    : { stacked: false, left: 136, right: width - 28, top: 30, lane: 38, labelY: 23, barY: 8 };
}

function formatRate(value: number): string {
  if (value <= 0) return '0';
  if (value < 1) return Number(value.toPrecision(2)).toString();
  return formatCount(value);
}

/** Radio buttons when the row has room, and a native select below 30rem so the options never wrap. */
function ScaleControl({ value, onChange }: { value: Choice; onChange: (id: Choice) => void }) {
  const id = useId();
  const hydrated = useHydrated();
  return (
    <div className="sdv-estimator__scale">
      <Segmented label="Scale" value={value} options={presetOptions} onChange={onChange} />
      <div className="sdv-control sdv-estimator__scale-select">
        <div className="sdv-control__row">
          <label htmlFor={id}>Scale</label>
        </div>
        <select
          id={id}
          value={value}
          disabled={!hydrated}
          onChange={(event) => onChange(event.currentTarget.value as Choice)}
        >
          {presetOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {value === 'custom' && (
            <option value="custom" disabled>
              Custom (set by the sliders)
            </option>
          )}
        </select>
      </div>
    </div>
  );
}

/** Back-of-envelope calculator for the URL shortener, with every formula shown. */
export default function EstimatorWidget() {
  const [choice, setChoice] = useState<Choice>('startup');
  const [inputs, setInputs] = useState<EstimateInputs>({ ...presets.startup.inputs });
  const result = useMemo(() => estimate(inputs), [inputs]);

  const update = (changes: Partial<EstimateInputs>) => {
    setInputs((current) => ({ ...current, ...changes }));
    setChoice('custom');
  };
  const pickPreset = (id: Choice) => {
    if (id === 'custom') return;
    setChoice(id);
    setInputs({ ...presets[id].inputs });
  };

  const chartRef = useRef<HTMLDivElement>(null);
  const chartWidth = useElementWidth(chartRef, FALLBACK_WIDTH);
  const layout = chartLayout(chartWidth);

  const perServer = inputs.requestsPerServer * TARGET_UTILIZATION;
  const lanes = [
    { label: 'Writes per second', value: result.writesPerSecond, tone: 'write' },
    { label: 'Reads per second', value: result.readsPerSecond, tone: 'read' },
    { label: 'Peak requests', value: result.peakRequestsPerSecond, tone: 'peak' },
  ] as const;
  const range = logRange([...lanes.map((lane) => lane.value), perServer]);
  const plotWidth = layout.right - layout.left;
  const xFor = (value: number) => layout.left + logFraction(value, range) * plotWidth;
  const ticks = logTicks(range, plotWidth);
  const lanesBottom = layout.top + lanes.length * layout.lane;
  const chartHeight = lanesBottom + 36;
  const limitX = xFor(perServer);
  const limitAnchor =
    limitX - layout.left < LIMIT_LABEL_HALF_WIDTH
      ? 'start'
      : layout.right - limitX < LIMIT_LABEL_HALF_WIDTH
        ? 'end'
        : 'middle';
  const shown = Math.min(result.serversNeeded, SERVER_ICONS_SHOWN);
  const code = SAMPLE_CODE.slice(0, result.shortCodeLength).padEnd(result.shortCodeLength, 'x');

  const summary = `${formatRate(result.peakRequestsPerSecond)} requests per second at peak, ${formatBytes(result.storageBytes)} of storage, ${result.serversNeeded} app server${result.serversNeeded === 1 ? '' : 's'}, ${result.shortCodeLength} character codes.`;

  return (
    <MotionRoot>
      <WidgetFrame
        title="Size the URL shortener"
        instructions="Pick a scale, then drag the sliders. Watch which numbers grow by orders of magnitude and which barely move."
        summary={summary}
        statsCaption="The math, step by step"
        stats={[
          {
            label: 'Writes per second',
            value: formatRate(result.writesPerSecond),
            detail: `${formatCount(inputs.newLinksPerDay)} new links a day ÷ 86,400 seconds`,
          },
          {
            label: 'Reads per second',
            value: formatRate(result.readsPerSecond),
            detail: `writes × ${formatCount(inputs.readsPerWrite)} clicks per link`,
          },
          {
            label: 'Peak requests per second',
            value: formatRate(result.peakRequestsPerSecond),
            detail: `(writes + reads) × ${inputs.peakToAverage} for the busiest hour`,
          },
          {
            label: 'Links stored',
            value: formatCount(result.totalLinks),
            detail: `links a day × 365 × ${inputs.retentionYears} years`,
          },
          {
            label: 'Storage',
            value: formatBytes(result.storageBytes),
            detail: `links × ${inputs.bytesPerLink} bytes each`,
          },
          {
            label: 'Cache for hot links',
            value: formatBytes(result.cacheBytes),
            detail: `${Math.round(inputs.hotFraction * 100)}% of a day's reads × ${inputs.bytesPerLink} bytes`,
          },
          {
            label: 'App servers at peak',
            value: String(result.serversNeeded),
            detail: `peak ÷ (${formatCount(inputs.requestsPerServer)} per server × ${TARGET_UTILIZATION * 100}% target)`,
          },
          {
            label: 'Short code length',
            value: `${result.shortCodeLength} characters`,
            detail: `smallest n where 62 to the power n ≥ ${formatCount(result.totalLinks)}`,
          },
        ]}
        controls={
          <>
            <ScaleControl value={choice} onChange={pickPreset} />
            <Slider
              label="New links per day"
              value={Math.log10(inputs.newLinksPerDay)}
              min={2}
              max={9}
              step={0.25}
              format={(v) => formatCount(Math.round(10 ** v))}
              onChange={(v) => update({ newLinksPerDay: Math.round(10 ** v) })}
            />
            <Slider
              label="Clicks per link"
              value={Math.log10(inputs.readsPerWrite)}
              min={0}
              max={3}
              step={0.25}
              format={(v) => formatCount(Math.round(10 ** v))}
              onChange={(v) => update({ readsPerWrite: Math.round(10 ** v) })}
              hint="Reads per write. Shorteners are read heavy."
            />
            <Slider
              label="Peak vs average traffic"
              value={inputs.peakToAverage}
              min={1}
              max={10}
              step={0.5}
              format={(v) => `${v}×`}
              onChange={(v) => update({ peakToAverage: v })}
            />
            <Slider
              label="Years to keep links"
              value={inputs.retentionYears}
              min={1}
              max={20}
              format={(v) => `${v} year${v === 1 ? '' : 's'}`}
              onChange={(v) => update({ retentionYears: v })}
            />
          </>
        }
      >
        <div className="sdv-estimator">
          <div className="sdv-estimator__chart" ref={chartRef}>
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              role="img"
              aria-label={`Log scale chart from ${formatRate(10 ** range.min)} to ${formatRate(10 ** range.max)} requests per second. Writes ${formatRate(result.writesPerSecond)}, reads ${formatRate(result.readsPerSecond)}, peak ${formatRate(result.peakRequestsPerSecond)} requests per second. One server handles about ${formatCount(perServer)} per second at the target load.`}
            >
              {ticks.map((tick) => {
                const x = xFor(10 ** tick.exponent);
                return (
                  <g key={tick.exponent} className="sdv-axis">
                    <line x1={x} x2={x} y1={layout.top - 8} y2={lanesBottom} />
                    {tick.label !== null && (
                      <text x={x} y={layout.top - 14} textAnchor="middle">
                        {tick.label}
                      </text>
                    )}
                  </g>
                );
              })}
              {lanes.map((lane, index) => {
                const y = layout.top + index * layout.lane;
                const barY = y + layout.barY;
                const width = Math.max(2, xFor(lane.value) - layout.left);
                const inside = layout.left + width > layout.right - 70;
                return (
                  <g key={lane.label}>
                    <text
                      className="sdv-estimator__lane"
                      x={layout.stacked ? layout.left : layout.left - 10}
                      y={y + layout.labelY}
                      textAnchor={layout.stacked ? 'start' : 'end'}
                    >
                      {lane.label}
                    </text>
                    <m.rect
                      className={`sdv-estimator__bar sdv-estimator__bar--${lane.tone}`}
                      x={layout.left}
                      y={barY}
                      height={BAR_HEIGHT}
                      rx={4}
                      initial={false}
                      animate={{ width }}
                      transition={{ type: 'spring', stiffness: 140, damping: 20 }}
                    />
                    <m.g
                      initial={false}
                      animate={{ x: layout.left + width + (inside ? -8 : 8) }}
                      transition={{ type: 'spring', stiffness: 140, damping: 20 }}
                    >
                      <text
                        className={`sdv-estimator__value${inside ? ' sdv-estimator__value--inside' : ''}`}
                        y={barY + 15}
                        textAnchor={inside ? 'end' : 'start'}
                      >
                        {formatRate(lane.value)}/s
                      </text>
                    </m.g>
                  </g>
                );
              })}
              <g className="sdv-estimator__limit">
                <line x1={limitX} x2={limitX} y1={layout.top - 4} y2={lanesBottom + 4} />
                <text x={limitX} y={lanesBottom + 22} textAnchor={limitAnchor}>
                  One server: about {formatCount(perServer)}/s
                </text>
              </g>
            </svg>
          </div>

          <div className="sdv-estimator__row">
            <div className="sdv-estimator__servers">
              <p className="sdv-estimator__heading">
                App servers at peak: <strong>{result.serversNeeded}</strong>
              </p>
              <ul className="sdv-estimator__grid" aria-hidden="true">
                {Array.from({ length: shown }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: identical, order-only items
                  <li key={i} />
                ))}
              </ul>
              {result.serversNeeded > shown && (
                <p className="sdv-estimator__more">and {formatCount(result.serversNeeded - shown)} more</p>
              )}
            </div>
            <div className="sdv-estimator__code">
              <p className="sdv-estimator__heading">
                Short code: <strong>{result.shortCodeLength} characters</strong>
              </p>
              <p className="sdv-estimator__url">
                <span className="sdv-visually-hidden">Example short link: sho.rt/{code}</span>
                <span aria-hidden="true">
                  <span>sho.rt/</span>
                  {code.split('').map((char, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: characters repeat
                    <kbd key={i}>{char}</kbd>
                  ))}
                </span>
              </p>
              <p className="sdv-estimator__more">
                62 to the power {result.shortCodeLength} = {formatCount(62 ** result.shortCodeLength)}{' '}
                possible codes
              </p>
            </div>
          </div>
        </div>
      </WidgetFrame>
    </MotionRoot>
  );
}
