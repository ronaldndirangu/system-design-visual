import { useMemo, useState } from 'react';
import {
  type BurstAt,
  burstOptions,
  SHAPES_ALERT,
  SHAPES_SECONDS,
  type ShapeWindow,
  SLIDE_SECONDS,
  TUMBLING_SECONDS,
  windowShapes,
} from '../../lib/models/windowing';
import { Slider } from '../sim/controls';
import { ScenarioChips } from '../sim/ScenarioChips';
import type { Tone } from '../sim/StatTable';
import { WidgetFrame } from '../sim/WidgetFrame';
import './WindowShapesWidget.css';

const bursts: BurstAt[] = ['inside', 'across'];
/** Dots stack in 1 s columns. */
const BUCKET_SECONDS = 1;
const BUCKETS = SHAPES_SECONDS / BUCKET_SECONDS;
const SLIDING_PER_CLICK = TUMBLING_SECONDS / SLIDE_SECONDS;

const span = (window: ShapeWindow) => `${window.startSeconds} to ${window.endSeconds} s`;
const position = (window: ShapeWindow) => ({
  left: `${(window.startSeconds / SHAPES_SECONDS) * 100}%`,
  width: `${((window.endSeconds - window.startSeconds) / SHAPES_SECONDS) * 100}%`,
});
const over = (window: ShapeWindow) => window.count > SHAPES_ALERT;

function WindowBox({ window, selected = false }: { window: ShapeWindow; selected?: boolean }) {
  return (
    <li
      className="sdv-wshapes__box"
      style={position(window)}
      data-over={over(window) ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
    >
      <span className="sdv-visually-hidden">{span(window)}: </span>
      {window.count}
      {over(window) ? ', alert' : ''}
      {selected && <span className="sdv-visually-hidden"> (selected)</span>}
    </li>
  );
}

/** Tumbling and sliding windows over the same 30 s of clicks, with a burst placed inside or across a boundary. */
export default function WindowShapesWidget() {
  const [burst, setBurst] = useState<BurstAt>('across');
  const [slide, setSlide] = useState(6);
  const shapes = useMemo(() => windowShapes(burst), [burst]);
  const { clicks, tumbling, sliding } = shapes;
  const selected = sliding[slide] ?? sliding[0];

  const buckets = useMemo(() => {
    const list = Array.from({ length: BUCKETS }, () => [] as boolean[]);
    for (const click of clicks) {
      const index = Math.min(BUCKETS - 1, Math.floor(click.tick / (BUCKET_SECONDS * 10)));
      list[index]?.push(click.burst);
    }
    return list;
  }, [clicks]);

  if (!selected) return null;

  const burstCount = clicks.filter((click) => click.burst).length;
  const tumblingMax = Math.max(...tumbling.map((window) => window.count));
  const slidingMax = Math.max(...sliding.map((window) => window.count));
  const tumblingOver = tumbling.filter(over).length;
  const slidingOver = sliding.filter(over).length;
  const burstStart = burstOptions[burst].startSeconds;

  const status: { tone: Tone; text: string } =
    tumblingOver > 0
      ? { tone: 'ok', text: 'Both shapes catch the burst' }
      : { tone: 'bad', text: 'Tumbling windows miss the burst' };

  const summary = `${burstOptions[burst].label}. Tumbling windows count ${tumbling.map((window) => window.count).join(', ')}, so ${tumblingOver > 0 ? 'the alert fires' : `no tumbling window crosses ${SHAPES_ALERT}`}. Sliding windows peak at ${slidingMax}, and ${slidingOver} of ${sliding.length} cross ${SHAPES_ALERT}. The window from ${span(selected)} holds ${selected.count} clicks.`;

  const insideSelected = (second: number) => second >= selected.startSeconds && second < selected.endSeconds;

  return (
    <WidgetFrame
      title="Tumbling and sliding windows"
      instructions={`Each dot is one click, and each diamond is a click from the burst. Pick where the burst lands, then move the slider to see which clicks one sliding window counts. The alert fires when a window holds more than ${SHAPES_ALERT} clicks.`}
      summary={summary}
      status={status}
      stats={[
        {
          label: `Selected sliding window, ${span(selected)}`,
          value: `${selected.count} clicks`,
          tone: over(selected) ? 'warn' : undefined,
          detail: over(selected)
            ? `over the alert line of ${SHAPES_ALERT}`
            : `under the alert line of ${SHAPES_ALERT}`,
        },
        {
          label: 'Highest tumbling count',
          value: String(tumblingMax),
          tone: tumblingOver > 0 ? 'ok' : 'bad',
          detail:
            tumblingOver > 0 ? 'the alert fires' : 'the burst is split between two windows, so no alert',
        },
        {
          label: 'Highest sliding count',
          value: String(slidingMax),
          tone: slidingOver > 0 ? 'ok' : 'bad',
          detail: `${slidingOver} of ${sliding.length} sliding windows cross the alert line`,
        },
        {
          label: 'Results per minute',
          value: `${60 / TUMBLING_SECONDS} tumbling, ${60 / SLIDE_SECONDS} sliding`,
          detail: `each click lands in 1 tumbling window and ${SLIDING_PER_CLICK} sliding windows`,
        },
      ]}
      controls={
        <Slider
          label="Sliding window shown"
          value={slide}
          min={0}
          max={sliding.length - 1}
          format={(value) => {
            const window = sliding[value];
            return window ? span(window) : '';
          }}
          onChange={setSlide}
        />
      }
    >
      <ScenarioChips
        label="Where the burst lands"
        value={burst}
        options={bursts.map((id) => ({
          value: id,
          label: burstOptions[id].label,
          diff: burstOptions[id].diff,
        }))}
        onChange={setBurst}
      />
      <div className="sdv-wshapes">
        <div className="sdv-wshapes__track">
          <div
            className="sdv-wshapes__dots"
            role="img"
            aria-label={`${clicks.length} clicks over ${SHAPES_SECONDS} s: about 2 a second, plus a burst of ${burstCount} from ${burstStart} to ${burstStart + 2} s. Clicks inside the selected window, ${span(selected)}, are bright; the rest are dimmed.`}
          >
            <span className="sdv-wshapes__band" style={position(selected)} />
            {buckets.map((bucket, second) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: buckets are fixed 1 s slots in time order
                key={second}
                className="sdv-wshapes__bucket"
                data-dim={insideSelected(second * BUCKET_SECONDS) ? undefined : 'true'}
              >
                {bucket.map((isBurst, index) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: dots in a bucket have no identity beyond order
                    key={index}
                    className="sdv-wshapes__dot"
                    data-burst={isBurst ? 'true' : undefined}
                  />
                ))}
              </span>
            ))}
          </div>
          <div className="sdv-wshapes__axis" aria-hidden="true">
            {[0, 10, 20, 30].map((second) => (
              <span key={second} style={{ left: `${(second / SHAPES_SECONDS) * 100}%` }}>
                {second} s
              </span>
            ))}
          </div>
        </div>
        <div className="sdv-wshapes__group">
          <p className="sdv-wshapes__label">Tumbling: {TUMBLING_SECONDS} s windows, one result every 10 s</p>
          <ol className="sdv-wshapes__row" aria-label="Tumbling window counts">
            {tumbling.map((window) => (
              <WindowBox key={window.startSeconds} window={window} />
            ))}
          </ol>
        </div>
        <div className="sdv-wshapes__group">
          <p className="sdv-wshapes__label">
            Sliding: {TUMBLING_SECONDS} s windows that start every {SLIDE_SECONDS} s
          </p>
          <ol className="sdv-wshapes__stack" aria-label="Sliding window counts">
            {sliding.map((window, index) => (
              <WindowBox key={window.startSeconds} window={window} selected={index === slide} />
            ))}
          </ol>
        </div>
        <ul className="sdv-qtracks__legend" aria-label="How to read the windows">
          <li>
            <span className="sdv-wshapes__key" data-kind="dot" aria-hidden="true" />
            One click (circle)
          </li>
          <li>
            <span className="sdv-wshapes__key" data-kind="burst" aria-hidden="true" />
            One click from the burst (diamond)
          </li>
          <li>
            <span className="sdv-wshapes__key" data-kind="over" aria-hidden="true" />
            Over {SHAPES_ALERT} clicks: the alert fires (thick dashed border, labeled alert)
          </li>
          <li>
            <span className="sdv-wshapes__key" data-kind="selected" aria-hidden="true" />
            The sliding window the slider shows (shaded band)
          </li>
        </ul>
      </div>
    </WidgetFrame>
  );
}
