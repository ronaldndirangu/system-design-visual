import { useState } from 'react';
import { formatBytes } from '../../lib/models/estimates';
import {
  egressEstimate,
  ILLUSTRATIVE_CDN_PER_GB,
  ILLUSTRATIVE_ORIGIN_PER_GB,
  LADDER,
} from '../../lib/models/videoStreaming';
import { Segmented, Slider } from '../sim/controls';
import type { Tone } from '../sim/StatTable';
import { WidgetFrame } from '../sim/WidgetFrame';
import './EgressCostWidget.css';

type ViewsId = '1M' | '10M' | '100M' | '1B';

const VIEWS: Record<ViewsId, number> = { '1M': 1e6, '10M': 1e7, '100M': 1e8, '1B': 1e9 };
const viewOptions = (Object.keys(VIEWS) as ViewsId[]).map((value) => ({ value, label: value }));

const RUNG_CHOICES = ['480p', '720p', '1080p'] as const;
type RungId = (typeof RUNG_CHOICES)[number];

const mbpsOf = (rung: RungId) => LADDER.find((entry) => entry.label === rung)?.mbps ?? 0;
const rungOptions = RUNG_CHOICES.map((value) => ({ value, label: `${value}, ${mbpsOf(value)} Mbps` }));

const dollars = (value: number) => `$${Number(value.toPrecision(3)).toLocaleString('en-US')}`;
const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;
const perGb = (price: number) => `$${price.toFixed(2)} per GB`;

interface Props {
  title?: string;
}

export default function EgressCostWidget({ title = 'What serving the video costs each month' }: Props) {
  const [viewsId, setViewsId] = useState<ViewsId>('10M');
  const [minutes, setMinutes] = useState(6);
  const [rung, setRung] = useState<RungId>('720p');
  const [hitPercent, setHitPercent] = useState(90);

  const hitRatio = hitPercent / 100;
  const mbps = mbpsOf(rung);
  const { deliveredBytes, originBytes, costWithoutCdn, costWithCdn } = egressEstimate({
    monthlyViews: VIEWS[viewsId],
    watchMinutes: minutes,
    mbps,
    hitRatio,
  });
  const edgeBytes = deliveredBytes - originBytes;
  const cdnDelivery = (deliveredBytes / 1e9) * ILLUSTRATIVE_CDN_PER_GB;
  const originFill = costWithCdn - cdnDelivery;
  const costScale = Math.max(costWithoutCdn, costWithCdn);
  const costShare = (value: number) => `${(value / costScale) * 100}%`;
  const change = (costWithCdn - costWithoutCdn) / costWithoutCdn;

  const status: { tone: Tone; text: string } =
    Math.abs(change) < 0.005
      ? { tone: 'neutral', text: 'CDN breaks even' }
      : change < 0
        ? { tone: 'ok', text: `CDN cuts the bill ${percent(-change)}` }
        : { tone: 'warn', text: 'CDN costs more at this hit ratio' };

  const summary =
    `${formatBytes(deliveredBytes)} delivered, ${formatBytes(originBytes)} of it from the origin. ` +
    `Illustrative bill ${dollars(costWithoutCdn)} without a CDN, ${dollars(costWithCdn)} with one.`;

  return (
    <WidgetFrame
      title={title}
      instructions="Toy egress calculator. Change the traffic, the bitrate, and how much the CDN edges catch. Prices are round illustrative numbers, not quotes from any provider."
      summary={summary}
      status={status}
      stats={[
        {
          label: 'Delivered to viewers',
          value: formatBytes(deliveredBytes),
          detail: `${viewsId} views × ${minutes} min × ${mbps} Mbps`,
        },
        {
          label: 'Pulled from object storage',
          value: formatBytes(originBytes),
          detail: `the ${percent(1 - hitRatio)} the edges miss, mostly the long tail of rarely watched videos`,
        },
        {
          label: 'Bill without a CDN',
          value: dollars(costWithoutCdn),
          detail: `every byte leaves the origin at ${perGb(ILLUSTRATIVE_ORIGIN_PER_GB)}`,
        },
        {
          label: 'Bill with a CDN',
          value: dollars(costWithCdn),
          tone: status.tone,
          detail: `CDN delivery ${dollars(cdnDelivery)} plus origin fills ${dollars(originFill)}`,
        },
      ]}
      controls={
        <>
          <Segmented label="Views per month" value={viewsId} options={viewOptions} onChange={setViewsId} />
          <Slider
            label="Minutes watched per view"
            value={minutes}
            min={1}
            max={30}
            onChange={setMinutes}
            format={(value) => `${value} min`}
          />
          <Segmented
            label="Average bitrate delivered"
            value={rung}
            options={rungOptions}
            onChange={setRung}
          />
          <Slider
            label="CDN hit ratio"
            value={hitPercent}
            min={0}
            max={99}
            onChange={setHitPercent}
            format={(value) => `${value}%`}
            hint="Share of bytes the edges serve from cache. Popular videos hit; the long tail misses."
          />
        </>
      }
    >
      <div className="sdv-egress">
        <p className="sdv-egress__caption">Where this month's {formatBytes(deliveredBytes)} come from</p>
        <span className="sdv-egress__track" aria-hidden="true">
          <span className="sdv-egress__edge" style={{ width: `${hitRatio * 100}%` }} />
          <span className="sdv-egress__origin" style={{ width: `${(1 - hitRatio) * 100}%` }} />
        </span>
        <ul className="sdv-legend" aria-label="Where the bytes come from">
          <li>
            <span className="sdv-egress__key sdv-egress__edge" aria-hidden="true" />
            Solid: CDN edge cache, {formatBytes(edgeBytes)} ({percent(hitRatio)})
          </li>
          <li>
            <span className="sdv-egress__key sdv-egress__origin" aria-hidden="true" />
            Striped: object storage, the origin, {formatBytes(originBytes)} ({percent(1 - hitRatio)})
          </li>
        </ul>
        <p className="sdv-egress__caption">
          Monthly delivery bill at illustrative prices, same scale for both
        </p>
        <ul className="sdv-egress__rows">
          <li className="sdv-egress__row">
            <span className="sdv-egress__name">Origin serves every byte</span>
            <span className="sdv-egress__track" aria-hidden="true">
              <span className="sdv-egress__origin" style={{ width: costShare(costWithoutCdn) }} />
            </span>
            <span className="sdv-egress__value">{dollars(costWithoutCdn)}</span>
          </li>
          <li className="sdv-egress__row">
            <span className="sdv-egress__name">CDN in front of the origin</span>
            <span className="sdv-egress__track" aria-hidden="true">
              <span className="sdv-egress__edge" style={{ width: costShare(cdnDelivery) }} />
              <span className="sdv-egress__origin" style={{ width: costShare(originFill) }} />
            </span>
            <span className="sdv-egress__value">
              {dollars(cdnDelivery)} CDN delivery plus {dollars(originFill)} origin fills ={' '}
              {dollars(costWithCdn)}
            </span>
          </li>
        </ul>
        <p className="sdv-egress__caption">
          Illustrative prices: origin egress {perGb(ILLUSTRATIVE_ORIGIN_PER_GB)}, CDN delivery{' '}
          {perGb(ILLUSTRATIVE_CDN_PER_GB)}. Real prices vary by provider, region, and committed volume.
        </p>
      </div>
    </WidgetFrame>
  );
}
