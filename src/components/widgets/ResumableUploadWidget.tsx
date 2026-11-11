import { useState } from 'react';
import { uploadComparison } from '../../lib/models/videoStreaming';
import { Segmented, Slider } from '../sim/controls';
import type { Tone } from '../sim/StatTable';
import { WidgetFrame } from '../sim/WidgetFrame';
import './ResumableUploadWidget.css';

const FILE_MEGABYTES = 2000;
const PARALLEL = 4;
const MAX_DROPS = 5;
/** One fixed scale, so a bar only grows when the waste grows. The worst case is one request with every drop. */
const SCALE_MEGABYTES = FILE_MEGABYTES * (1 + MAX_DROPS / 2);
/** Above this many parts the strip is too narrow for retry counts inside each part. */
const LABELLED_PARTS = 20;

type PartSize = '25' | '100' | '500';

const partOptions: { value: PartSize; label: string }[] = [
  { value: '25', label: '25 MB' },
  { value: '100', label: '100 MB' },
  { value: '500', label: '500 MB' },
];

const mb = (value: number) => `${Math.round(value).toLocaleString('en-US')} MB`;
const share = (value: number) => `${(value / SCALE_MEGABYTES) * 100}%`;
const times = (count: number) => (count === 1 ? 'once' : count === 2 ? 'twice' : `${count} times`);
const plural = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`;

/** Spreads the drops evenly through the upload. Each drop cuts every part in flight at that moment. */
function retriesPerPart(parts: number, drops: number): number[] {
  const retries = new Array<number>(parts).fill(0);
  const batches = Math.ceil(parts / PARALLEL);
  for (let drop = 1; drop <= drops; drop += 1) {
    const batch = Math.min(batches - 1, Math.floor((drop * batches) / (drops + 1)));
    for (let part = batch * PARALLEL; part < Math.min(parts, (batch + 1) * PARALLEL); part += 1) {
      retries[part] = (retries[part] ?? 0) + 1;
    }
  }
  return retries;
}

function retrySentence(retries: number[]): string {
  const groups = new Map<number, number>();
  for (const count of retries) groups.set(count, (groups.get(count) ?? 0) + 1);
  const clean = groups.get(0) ?? 0;
  if (clean === retries.length) return `All ${retries.length} parts went through on the first try.`;
  const retried = [...groups.entries()]
    .filter(([count]) => count > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([count, parts]) => `${plural(parts, 'part')} sent again ${times(count)}`);
  return `${retried.join(', ')}. ${clean === 0 ? 'None' : clean} went through on the first try.`;
}

interface Props {
  title?: string;
}

export default function ResumableUploadWidget({ title = 'One request versus multipart upload' }: Props) {
  const [drops, setDrops] = useState(3);
  const [partSize, setPartSize] = useState<PartSize>('100');
  const partMegabytes = Number(partSize);
  const { single, multipart } = uploadComparison({
    fileMegabytes: FILE_MEGABYTES,
    partMegabytes,
    drops,
    parallel: PARALLEL,
  });
  const inFlight = Math.min(PARALLEL, multipart.parts);
  const singleLossPerDrop = FILE_MEGABYTES / 2;
  const multipartLossPerDrop = inFlight * (FILE_MEGABYTES / multipart.parts / 2);
  const dropNumbers = Array.from({ length: drops }, (_, index) => index + 1);
  const parts = retriesPerPart(multipart.parts, drops).map((retries, index) => ({ id: index + 1, retries }));
  const sentence = retrySentence(parts.map((part) => part.retries));

  const status: { tone: Tone; text: string } =
    drops === 0
      ? { tone: 'neutral', text: 'No drops, nothing sent twice' }
      : multipart.wastedMegabytes < single.wastedMegabytes
        ? {
            tone: 'ok',
            text: `Multipart wastes ${Math.round(single.wastedMegabytes / multipart.wastedMegabytes)}× less`,
          }
        : { tone: 'warn', text: 'Parts too big to help' };

  const summary =
    `${plural(drops, 'drop')}, ${partSize} MB parts. One request sends ${mb(single.sentMegabytes)}, ` +
    `${mb(single.wastedMegabytes)} of it thrown away. Multipart sends ${mb(multipart.sentMegabytes)}, ` +
    `${mb(multipart.wastedMegabytes)} thrown away, in ${multipart.requests} requests.`;

  return (
    <WidgetFrame
      title={title}
      instructions="Toy model of uploading a 2,000 MB video over a flaky connection, with 4 parts in flight at once. Drops arrive evenly through the upload, and each one cuts every transfer in flight halfway through."
      summary={summary}
      status={status}
      stats={[
        {
          label: 'One request',
          value: `${mb(single.sentMegabytes)} sent`,
          detail:
            drops === 0
              ? '1 request, nothing thrown away'
              : `${mb(single.wastedMegabytes)} thrown away; ${single.requests} requests, each restarting from byte zero`,
        },
        {
          label: 'Multipart, resumable',
          value: `${mb(multipart.sentMegabytes)} sent`,
          detail: `${mb(multipart.wastedMegabytes)} thrown away; ${multipart.requests} requests: start, ${multipart.parts} parts, ${multipart.retriedParts} part ${multipart.retriedParts === 1 ? 'retry' : 'retries'}, complete`,
        },
        {
          label: 'Bytes one drop throws away',
          value: `${mb(singleLossPerDrop)} versus ${mb(multipartLossPerDrop)}`,
          detail: `one request loses half the file; multipart loses half of each of the ${plural(inFlight, 'part')} in flight`,
        },
      ]}
      controls={
        <>
          <Slider
            label="Connection drops during the upload"
            value={drops}
            min={0}
            max={MAX_DROPS}
            onChange={setDrops}
            format={(value) => plural(value, 'drop')}
          />
          <Segmented label="Part size" value={partSize} options={partOptions} onChange={setPartSize} />
        </>
      }
    >
      <div className="sdv-upload">
        <p className="sdv-upload__caption">
          Megabytes sent to finish one {mb(FILE_MEGABYTES)} upload. Both bars share one scale, up to{' '}
          {mb(SCALE_MEGABYTES)}.
        </p>
        <ul className="sdv-upload__rows">
          <li className="sdv-upload__row">
            <span className="sdv-upload__name">One request</span>
            <span className="sdv-upload__track" aria-hidden="true">
              <span className="sdv-upload__useful" style={{ width: share(FILE_MEGABYTES) }} />
              {dropNumbers.map((drop) => (
                <span key={drop} className="sdv-upload__wasted" style={{ width: share(singleLossPerDrop) }} />
              ))}
            </span>
            <span className="sdv-upload__value">
              {mb(single.sentMegabytes)} sent, {mb(single.wastedMegabytes)} thrown away
            </span>
          </li>
          <li className="sdv-upload__row">
            <span className="sdv-upload__name">Multipart, resumable</span>
            <span className="sdv-upload__track" aria-hidden="true">
              <span className="sdv-upload__useful" style={{ width: share(FILE_MEGABYTES) }} />
              {dropNumbers.map((drop) => (
                <span
                  key={drop}
                  className="sdv-upload__wasted"
                  style={{ width: share(multipartLossPerDrop) }}
                />
              ))}
            </span>
            <span className="sdv-upload__value">
              {mb(multipart.sentMegabytes)} sent, {mb(multipart.wastedMegabytes)} thrown away
            </span>
          </li>
        </ul>
        <ul className="sdv-legend" aria-label="How to read the bars">
          <li>
            <span className="sdv-upload__key sdv-upload__useful" aria-hidden="true" />
            Solid: bytes the file needs
          </li>
          <li>
            <span className="sdv-upload__key sdv-upload__wasted" aria-hidden="true" />
            Striped: bytes sent, then thrown away by a drop
          </li>
        </ul>
        <div className="sdv-upload__parts">
          <p className="sdv-upload__caption">
            The multipart file as {plural(multipart.parts, 'part')} of {partSize} MB, in upload order. Each
            striped block on top is one retry of that part
            {multipart.parts <= LABELLED_PARTS ? ', and the number counts them' : ''}.
          </p>
          <ol
            className="sdv-upload__strip"
            data-dense={multipart.parts > LABELLED_PARTS ? '' : undefined}
            aria-hidden="true"
          >
            {parts.map((part) => (
              <li key={part.id} className="sdv-upload__part">
                <span className="sdv-upload__sent" />
                {Array.from({ length: part.retries }, (_, retry) => retry + 1).map((retry) => (
                  <span key={retry} className="sdv-upload__wasted sdv-upload__retry" />
                ))}
                {part.retries > 0 && multipart.parts <= LABELLED_PARTS && (
                  <span className="sdv-upload__count">{part.retries}</span>
                )}
              </li>
            ))}
          </ol>
          <p className="sdv-upload__line">{sentence}</p>
        </div>
      </div>
    </WidgetFrame>
  );
}
