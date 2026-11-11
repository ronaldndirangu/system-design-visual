import { m } from 'motion/react';
import { useMemo, useState } from 'react';
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
import { WidgetFrame } from '../sim/WidgetFrame';

type Choice = PresetId | 'custom';

const presetOptions = (Object.keys(presets) as PresetId[]).map((id) => ({
  value: id,
  label: presets[id].label,
}));

const AXIS_MIN = -2;
const AXIS_MAX = 6;
const CHART = { width: 520, left: 112, right: 500, top: 34, lane: 38 };
const SERVER_ICONS_SHOWN = 48;
const SAMPLE_CODE = 'aZ3k9QxP2mT';

function xFor(value: number): number {
  const exponent = Math.log10(Math.max(value, 10 ** AXIS_MIN));
  const clamped = Math.min(AXIS_MAX, Math.max(AXIS_MIN, exponent));
  return CHART.left + ((clamped - AXIS_MIN) / (AXIS_MAX - AXIS_MIN)) * (CHART.right - CHART.left);
}

function formatRate(value: number): string {
  if (value <= 0) return '0';
  if (value < 1) return Number(value.toPrecision(2)).toString();
  return formatCount(value);
}

const tickLabels = ['0.01', '0.1', '1', '10', '100', '1K', '10K', '100K', '1M'];

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

  const perServer = inputs.requestsPerServer * TARGET_UTILIZATION;
  const lanes = [
    { label: 'Writes per second', value: result.writesPerSecond, tone: 'write' },
    { label: 'Reads per second', value: result.readsPerSecond, tone: 'read' },
    { label: 'Peak requests', value: result.peakRequestsPerSecond, tone: 'peak' },
  ] as const;
  const chartHeight = CHART.top + lanes.length * CHART.lane + 36;
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
            <Segmented label="Scale" value={choice} options={presetOptions} onChange={pickPreset} />
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
          <svg
            viewBox={`0 0 ${CHART.width} ${chartHeight}`}
            role="img"
            aria-label={`Log scale chart. Writes ${formatRate(result.writesPerSecond)}, reads ${formatRate(result.readsPerSecond)}, peak ${formatRate(result.peakRequestsPerSecond)} requests per second. One server handles about ${formatCount(perServer)} per second at the target load.`}
          >
            {tickLabels.map((label, index) => {
              const x = xFor(10 ** (AXIS_MIN + index));
              return (
                <g key={label} className="sdv-axis">
                  <line x1={x} x2={x} y1={CHART.top - 8} y2={CHART.top + lanes.length * CHART.lane} />
                  <text x={x} y={CHART.top - 14} textAnchor="middle">
                    {label}
                  </text>
                </g>
              );
            })}
            {lanes.map((lane, index) => {
              const y = CHART.top + index * CHART.lane + 8;
              const width = Math.max(2, xFor(lane.value) - CHART.left);
              const inside = CHART.left + width > CHART.right - 70;
              return (
                <g key={lane.label}>
                  <text className="sdv-estimator__lane" x={CHART.left - 10} y={y + 15} textAnchor="end">
                    {lane.label}
                  </text>
                  <m.rect
                    className={`sdv-estimator__bar sdv-estimator__bar--${lane.tone}`}
                    x={CHART.left}
                    y={y}
                    height={20}
                    rx={4}
                    initial={false}
                    animate={{ width }}
                    transition={{ type: 'spring', stiffness: 140, damping: 20 }}
                  />
                  <m.g
                    initial={false}
                    animate={{ x: CHART.left + width + (inside ? -8 : 8) }}
                    transition={{ type: 'spring', stiffness: 140, damping: 20 }}
                  >
                    <text
                      className={`sdv-estimator__value${inside ? ' sdv-estimator__value--inside' : ''}`}
                      y={y + 15}
                      textAnchor={inside ? 'end' : 'start'}
                    >
                      {formatRate(lane.value)}/s
                    </text>
                  </m.g>
                </g>
              );
            })}
            <g className="sdv-estimator__limit">
              <line
                x1={xFor(perServer)}
                x2={xFor(perServer)}
                y1={CHART.top - 4}
                y2={CHART.top + lanes.length * CHART.lane + 4}
              />
              <text x={xFor(perServer)} y={CHART.top + lanes.length * CHART.lane + 22} textAnchor="middle">
                One server: about {formatCount(perServer)}/s
              </text>
            </g>
          </svg>

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
