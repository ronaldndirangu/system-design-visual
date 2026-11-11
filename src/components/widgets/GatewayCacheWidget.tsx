import { useState } from 'react';
import {
  BLOCK_TOKENS,
  type CacheOutcome,
  type KeyField,
  keyFieldLabels,
  keyFieldOrder,
  type PrefixBlock,
  type PrefixOptions,
  prefixCacheResult,
  runResponseCache,
  type Segment,
  segmentLabels,
  wrongHitLabels,
} from '../../lib/models/aiGateway';
import { Segmented, Toggle } from '../sim/controls';
import type { StatRow } from '../sim/StatTable';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { WidgetFrame } from '../sim/WidgetFrame';
import { DiagramScroll } from '../viz/DiagramScroll';
import { UiIcon } from '../viz/icons';
import './GatewayWidgets.css';

type Mode = 'response' | 'prefix';

interface Props {
  initial?: Mode;
  title?: string;
  instructions?: string;
}

const outcomeTones: Record<CacheOutcome, Tone> = { miss: 'neutral', hit: 'ok', wrongHit: 'bad' };

const seconds = (value: number) => `${value.toFixed(2)} s`;

interface SegmentGroup {
  segment: Segment;
  blocks: PrefixBlock[];
}

function groupBlocks(blocks: PrefixBlock[]): SegmentGroup[] {
  const groups: SegmentGroup[] = [];
  for (const block of blocks) {
    const last = groups[groups.length - 1];
    if (last && last.segment === block.segment) last.blocks.push(block);
    else groups.push({ segment: block.segment, blocks: [block] });
  }
  return groups;
}

function blockText(block: PrefixBlock): string {
  const parts = block.segments.map((segment) => segmentLabels[segment]).join(' and ');
  return `Block ${block.index + 1} (${parts}): ${block.reused ? 'reused from the cache' : 'computed'}`;
}

export default function GatewayCacheWidget({
  initial = 'response',
  title = 'Two caches: answers versus prompt work',
  instructions = 'In the response cache, switch fields out of the cache key and watch which customers get the wrong answer. In the prefix cache, change the prompt layout and watch which blocks the model can reuse.',
}: Props) {
  const [mode, setMode] = useState<Mode>(initial);
  const [fields, setFields] = useState<KeyField[]>([...keyFieldOrder]);
  const [prefix, setPrefix] = useState<PrefixOptions>({
    secondStore: 'same',
    timestampFirst: false,
    salt: false,
    prefixCache: true,
  });

  const toggleField = (field: KeyField, on: boolean) =>
    setFields((current) => keyFieldOrder.filter((f) => (f === field ? on : current.includes(f))));
  const setOption = <K extends keyof PrefixOptions>(key: K, value: PrefixOptions[K]) =>
    setPrefix((current) => ({ ...current, [key]: value }));

  const results = runResponseCache(fields);
  const hits = results.filter((result) => result.outcome === 'hit').length;
  const wrongHits = results.filter((result) => result.outcome === 'wrongHit');
  const misses = results.filter((result) => result.outcome === 'miss').length;
  const missing = keyFieldOrder.filter((field) => !fields.includes(field));

  const blocks = prefixCacheResult(prefix);
  const groups = groupBlocks(blocks.blocks);
  const totalBlocks = blocks.blocks.length;
  const storeName = prefix.secondStore === 'same' ? 'Store A' : 'Store B';

  const responseStats: StatRow[] = [
    {
      label: 'Fields in the key',
      value: `${fields.length} of ${keyFieldOrder.length}, plus the question`,
      tone: missing.length === 0 ? 'ok' : 'warn',
      note: missing.length === 0 ? 'complete' : `missing ${missing.map((f) => keyFieldLabels[f]).join(', ')}`,
    },
    {
      label: 'Correct hits',
      value: `${hits} of ${results.length}`,
      detail: 'Served from the cache, same answer',
    },
    {
      label: 'Wrong hits',
      value: String(wrongHits.length),
      tone: wrongHits.length === 0 ? 'ok' : 'bad',
      note: wrongHits.length === 0 ? 'none' : 'wrong answer served',
    },
    { label: 'Model calls (misses)', value: String(misses) },
  ];

  const prefixStats: StatRow[] = [
    {
      label: 'Reused blocks',
      value: `${blocks.reusedBlocks} of ${totalBlocks}`,
      tone: blocks.reusedBlocks > 0 ? 'ok' : 'neutral',
      detail: `${blocks.reusedTokens} of ${blocks.totalTokens} prompt tokens, ${BLOCK_TOKENS} tokens per block`,
    },
    { label: 'Tokens to prefill', value: String(blocks.computedTokens) },
    {
      label: 'Time to first token',
      value: seconds(blocks.ttftSeconds),
      tone: blocks.ttftSeconds < blocks.coldTtftSeconds ? 'ok' : 'neutral',
      note: blocks.ttftSeconds < blocks.coldTtftSeconds ? 'faster than cold' : 'same as cold',
      detail: `${seconds(blocks.coldTtftSeconds)} with nothing cached (toy timing: queue + prefill + first token)`,
    },
    { label: 'The answer', value: 'Generated fresh', detail: 'The prefix cache never stores answers' },
  ];

  const status =
    mode === 'response'
      ? wrongHits.length > 0
        ? ({
            tone: 'bad',
            text: `${wrongHits.length} wrong ${wrongHits.length === 1 ? 'answer' : 'answers'} served`,
          } as const)
        : ({ tone: 'ok', text: 'Every hit is the right answer' } as const)
      : blocks.reusedBlocks > 0
        ? ({ tone: 'ok', text: `${blocks.reusedBlocks} blocks reused` } as const)
        : ({ tone: 'neutral', text: 'Nothing reused' } as const);

  const summary =
    mode === 'response'
      ? `Response cache keyed on ${fields.length} of ${keyFieldOrder.length} fields plus the question. ${hits} correct hits, ${
          wrongHits.length
        } wrong hits, ${misses} model calls.${wrongHits
          .map(
            (result) =>
              ` Step ${result.request.step}: ${result.reason ? wrongHitLabels[result.reason] : 'wrong answer'}.`,
          )
          .join('')}`
      : `Prefix cache ${prefix.prefixCache ? 'on' : 'off'}. The second request from ${storeName} reuses ${
          blocks.reusedBlocks
        } of ${totalBlocks} blocks and prefills ${blocks.computedTokens} tokens. Time to first token ${seconds(
          blocks.ttftSeconds,
        )} versus ${seconds(blocks.coldTtftSeconds)} cold. The answer is generated fresh.`;

  const prefixNote = !prefix.prefixCache
    ? 'The prefix cache is off, so the model prefills every token of every prompt.'
    : prefix.salt && prefix.secondStore === 'other'
      ? 'Each store gets its own salt, so Store B cannot reuse any of Store A’s blocks, even the shared system prompt. That isolation costs Store B the reuse.'
      : prefix.timestampFirst
        ? 'The timestamp changes on every request. Placed first, it breaks the very first block, and because each block’s hash chains the one before it, nothing after it matches either.'
        : prefix.secondStore === 'other'
          ? 'Store B shares the system prompt, so those blocks match. Its store policy differs, which breaks the chain from there on.'
          : 'Both requests start with the same system prompt and store policy, so those full blocks match. The timestamp and question differ, so the model computes them.';

  return (
    <WidgetFrame
      title={title}
      instructions={instructions}
      summary={summary}
      stats={mode === 'response' ? responseStats : prefixStats}
      statsCaption={mode === 'response' ? 'Response cache readout' : 'Prefix cache readout (toy numbers)'}
      status={status}
      controls={
        <>
          <Segmented
            label="Cache"
            value={mode}
            options={[
              { value: 'response', label: 'Response cache' },
              { value: 'prefix', label: 'Prefix (KV) cache' },
            ]}
            onChange={setMode}
          />
          {mode === 'response' ? (
            <fieldset className="sdv-control sdv-gw-fields">
              <legend>Cache key fields</legend>
              {keyFieldOrder.map((field) => (
                <Toggle
                  key={field}
                  label={keyFieldLabels[field]}
                  checked={fields.includes(field)}
                  onChange={(on) => toggleField(field, on)}
                />
              ))}
            </fieldset>
          ) : (
            <fieldset className="sdv-control sdv-gw-fields">
              <legend>Prompt and cache settings</legend>
              <Toggle
                label="Second request comes from Store B"
                checked={prefix.secondStore === 'other'}
                onChange={(on) => setOption('secondStore', on ? 'other' : 'same')}
              />
              <Toggle
                label="Timestamp at the start of the prompt"
                checked={prefix.timestampFirst}
                onChange={(on) => setOption('timestampFirst', on)}
              />
              <Toggle
                label="Salt the cache per store"
                checked={prefix.salt}
                onChange={(on) => setOption('salt', on)}
              />
              <Toggle
                label="Prefix cache on"
                checked={prefix.prefixCache}
                onChange={(on) => setOption('prefixCache', on)}
              />
            </fieldset>
          )}
        </>
      }
    >
      {mode === 'response' ? (
        <>
          <p className="sdv-gw-meta">
            An exact match cache stores each final answer under a key. A later request with the same key gets
            that answer without a model call. The question is always part of the key; the toggles add the
            other fields. These nine requests are fixtures.
          </p>
          {wrongHits.length > 0 ? (
            <div className="sdv-gw-alert" data-tone="bad">
              <UiIcon name="bad" />
              <ul>
                {wrongHits.map((result) => (
                  <li key={result.request.step}>
                    <strong>{result.reason ? wrongHitLabels[result.reason] : 'Wrong answer'}.</strong>{' '}
                    {`Step ${result.request.step}: ${result.request.context} The cache returned step ${result.from}’s answer: “${result.served}”`}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="sdv-gw-alert" data-tone="ok">
              <UiIcon name="ok" />
              <p>Every field that changes the answer is in the key, so the only hit is a true repeat.</p>
            </div>
          )}
          <DiagramScroll label="Response cache requests, scrollable">
            <table className="sdv-stats sdv-compare sdv-gw-table sdv-gw-pin">
              <caption>Nine requests, in order</caption>
              <thead>
                <tr>
                  <th scope="col">Step</th>
                  <th scope="col">What happens</th>
                  <th scope="col">Cache key</th>
                  <th scope="col">Result</th>
                  <th scope="col">Customer receives</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.request.step} data-outcome={result.outcome}>
                    <th scope="row">{result.request.step}</th>
                    <td>{result.request.context}</td>
                    <td>
                      <code className="sdv-gw-key">{result.key}</code>
                    </td>
                    <td>
                      <ToneBadge tone={outcomeTones[result.outcome]}>
                        {result.outcome === 'miss'
                          ? 'Miss: call the model'
                          : result.outcome === 'hit'
                            ? `Hit: same as step ${result.from}`
                            : `Wrong hit: step ${result.from}’s answer`}
                      </ToneBadge>
                    </td>
                    <td>{result.served}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DiagramScroll>
        </>
      ) : (
        <>
          <p className="sdv-gw-meta">
            {`Store A’s first request warms the cache. The second request, from ${storeName}, reuses a ${BLOCK_TOKENS} token block only if that block and every block before it match exactly. Reuse skips prefill work; the model still writes a fresh answer.`}
          </p>
          <ol className="sdv-gw-segments" aria-label={`The second prompt, ${totalBlocks} blocks in order`}>
            {groups.map((group) => (
              <li key={`${group.segment}-${group.blocks[0]?.index ?? 0}`} className="sdv-gw-segment">
                <span className="sdv-gw-segment-label">{segmentLabels[group.segment]}</span>
                <ol className="sdv-gw-blocks">
                  {group.blocks.map((block) => (
                    <li
                      key={block.index}
                      className="sdv-gw-strip-mark"
                      data-tone={block.reused ? 'ok' : 'neutral'}
                      title={blockText(block)}
                    >
                      <span aria-hidden="true">{block.reused ? 'R' : 'C'}</span>
                      <span className="sdv-visually-hidden">{blockText(block)}</span>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
          <ul className="sdv-legend" aria-label="How to read the blocks">
            <li>
              <span className="sdv-gw-strip-mark" data-tone="ok" aria-hidden="true">
                R
              </span>{' '}
              Reused from the cache
            </li>
            <li>
              <span className="sdv-gw-strip-mark" data-tone="neutral" aria-hidden="true">
                C
              </span>{' '}
              Computed (prefill)
            </li>
            <li>Token counts and timings are toy numbers.</li>
          </ul>
          <div className="sdv-gw-alert" data-tone={blocks.reusedBlocks > 0 ? 'ok' : 'neutral'}>
            <UiIcon name={blocks.reusedBlocks > 0 ? 'ok' : 'warn'} />
            <p>{prefixNote}</p>
          </div>
        </>
      )}
    </WidgetFrame>
  );
}
