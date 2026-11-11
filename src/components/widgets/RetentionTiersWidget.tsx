import { useState } from 'react';
import { formatBytes } from '../../lib/models/estimates';
import {
  DASHBOARD_RANGES,
  pointsScanned,
  type RangeId,
  RETENTION_TIERS,
  type RetentionTier,
  rawOnlyBytesPerSeries,
  tieredBytesPerSeries,
  tierFor,
} from '../../lib/models/metrics';
import { Segmented } from '../sim/controls';
import { ToneBadge } from '../sim/StatTable';
import { WidgetFrame } from '../sim/WidgetFrame';
import './RetentionTiersWidget.css';

const DAY = 86_400;
const RAW = RETENTION_TIERS[0] as RetentionTier;

/** Ordinal positions along the age axis, so an hour and a year both stay visible. */
const AXIS: { label: string; seconds: number; at: number }[] = [
  { label: 'now', seconds: 0, at: 0 },
  { label: '1 h', seconds: 3_600, at: 20 },
  { label: '1 d', seconds: DAY, at: 40 },
  { label: '7 d', seconds: 7 * DAY, at: 60 },
  { label: '30 d', seconds: 30 * DAY, at: 80 },
  { label: '1 y', seconds: 365 * DAY, at: 100 },
];

const positionOf = (seconds: number) => AXIS.find((mark) => mark.seconds >= seconds)?.at ?? 100;

const rangeOptions = (Object.keys(DASHBOARD_RANGES) as RangeId[]).map((id) => ({
  value: id,
  label: DASHBOARD_RANGES[id].label,
}));

const count = (value: number) => Math.round(value).toLocaleString('en-US');
const keptFor = (tier: RetentionTier) =>
  tier.retentionDays === 365 ? '1 year' : `${tier.retentionDays} days`;

export default function RetentionTiersWidget({ initial = 'hour' }: { initial?: RangeId }) {
  const [rangeId, setRangeId] = useState<RangeId>(initial);
  const range = DASHBOARD_RANGES[rangeId];
  const used = tierFor(range.seconds);
  const points = pointsScanned(range.seconds, used);
  const rawPoints = pointsScanned(range.seconds, RAW);
  const tiered = tieredBytesPerSeries();
  const rawOnly = rawOnlyBytesPerSeries();
  const rollup = used.id !== 'raw';
  const rangeAt = positionOf(range.seconds);

  const summary = rollup
    ? `A ${range.label} panel reads the ${used.label} tier: ${count(points)} points per series instead of ${count(rawPoints)} raw samples.`
    : `A ${range.label} panel reads the raw tier: ${count(points)} samples per series.`;

  return (
    <WidgetFrame
      title="Which tier answers the dashboard"
      instructions="Pick a dashboard time range. The toy query planner reads the finest tier that still holds the whole range. Tiers and sizes are illustrative."
      summary={summary}
      status={
        rollup
          ? { tone: 'ok', text: 'Rollups answer it' }
          : { tone: 'neutral', text: 'Raw samples answer it' }
      }
      stats={[
        {
          label: 'Tier that answers it',
          value: `${used.label}, kept ${keptFor(used)}`,
        },
        {
          label: 'Points read per series',
          value: count(points),
          detail: rollup
            ? `raw 10 s samples would be ${count(rawPoints)} points, ${Math.round(rawPoints / points)}× more`
            : 'the range fits inside the raw tier',
        },
        {
          label: 'Storage per series, all three tiers',
          value: formatBytes(tiered),
          detail: `keeping raw 10 s samples for a year instead: ${formatBytes(rawOnly)}, about ${Math.round(rawOnly / tiered)}× more`,
        },
      ]}
      controls={
        <Segmented label="Dashboard range" value={rangeId} options={rangeOptions} onChange={setRangeId} />
      }
    >
      <div className="sdv-retention">
        <p className="sdv-retention__caption">Age of data, from now back one year (not to scale)</p>
        <div className="sdv-retention__row">
          <span className="sdv-retention__name">Dashboard range: {range.label}</span>
          <span className="sdv-retention__track" aria-hidden="true">
            <span className="sdv-retention__range" style={{ width: `${rangeAt}%` }} />
          </span>
        </div>
        <ul className="sdv-retention__tiers">
          {RETENTION_TIERS.map((tier) => {
            const holds = tier.retentionDays * DAY >= range.seconds;
            return (
              <li
                key={tier.id}
                className="sdv-retention__row"
                data-used={tier.id === used.id ? '' : undefined}
              >
                <span className="sdv-retention__name">
                  <span className="sdv-retention__tier">
                    {tier.label}, kept {keptFor(tier)}
                  </span>
                  <span className="sdv-retention__values">
                    {tier.valuesPerPoint === 1 ? '1 value a point' : 'min, max, sum, count a point'}
                  </span>
                  {tier.id === used.id ? (
                    <ToneBadge tone="ok">Answers this panel</ToneBadge>
                  ) : (
                    <span className="sdv-retention__why">
                      {holds
                        ? 'Holds the range, coarser than needed'
                        : `Keeps only ${keptFor(tier)}, too short`}
                    </span>
                  )}
                </span>
                <span className="sdv-retention__track" aria-hidden="true">
                  <span
                    className="sdv-retention__bar"
                    style={{ width: `${positionOf(tier.retentionDays * DAY)}%` }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
        <div className="sdv-retention__row sdv-retention__row--axis" aria-hidden="true">
          <span />
          <span className="sdv-retention__axis">
            {AXIS.map((mark) => (
              <span key={mark.label} className="sdv-retention__mark" style={{ left: `${mark.at}%` }}>
                {mark.label}
              </span>
            ))}
          </span>
        </div>
        <p className="sdv-retention__note">
          Expiry is cheap: data lives in blocks that each cover a fixed time window, so when a whole block
          ages out of its tier the store deletes one file. Nothing scans for old rows.
        </p>
      </div>
    </WidgetFrame>
  );
}
