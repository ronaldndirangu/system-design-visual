import { describe, expect, it } from 'vitest';
import { betterIndex } from '../../src/lib/compare';
import {
  buildPostings,
  buildTrie,
  catalogUpdateLoad,
  clock,
  countTrieNodes,
  DAY_TICKS,
  formatDelay,
  miniDocs,
  QUERIES_PER_TICK,
  SearchDuel,
  type SearchScenarioId,
  type SearchSummary,
  scanLog,
  searchEstimates,
  searchMini,
  searchScenarios,
  stories,
  TOP_K,
  tokenize,
  typeaheadLog,
  walkTrie,
} from '../../src/lib/models/search';

function run(id: SearchScenarioId): SearchDuel {
  const duel = new SearchDuel(searchScenarios[id]);
  while (!duel.done) duel.step();
  return duel;
}

function shown(summary: SearchSummary) {
  return {
    recall: Math.round(summary.recall),
    missedBest: Math.round(summary.missedBestShare),
    unsearchableHours: Number((summary.unsearchableSeconds / 3_600).toFixed(1)),
    segmentsPerQuery: Number(summary.segmentsPerQuery.toFixed(1)),
    builds: summary.builds,
    writes: summary.writes,
  };
}

function meanFrom(values: number[], start: number): number {
  const tail = values.slice(start);
  return tail.reduce((sum, value) => sum + value, 0) / tail.length;
}

describe('search estimates', () => {
  it('derives the illustrative sizing the lesson quotes', () => {
    const estimates = searchEstimates();
    expect(estimates.indexBytes).toBe(540e9);
    expect(estimates.shards).toBe(18);
    expect(Math.round(estimates.averageQps)).toBe(6_667);
    expect(estimates.peakQps).toBeCloseTo(20_000, 6);
    expect(estimates.docsPerDay).toBe(5_184_000);
    expect(estimates.dailyNewShare).toBeCloseTo(0.0096, 6);
    expect(estimates.rebuildHours).toBe(3);
    expect(estimates.docsDuringRebuild).toBe(648_000);
    expect(estimates.maxBuildsPerDay).toBe(8);
    expect(estimates.rewritesPerNewDocAtOneMinute).toBe(150_000);
    expect(estimates.replicasPerShard).toBe(10);
    expect(estimates.searchServers).toBe(180);
    expect(estimates.typeaheadPeakQps).toBeCloseTo(120_000, 6);
  });

  it('sizes the challenge: catalog price and stock changes outnumber new documents', () => {
    const load = catalogUpdateLoad();
    expect(load.updatesPerDay).toBe(172_800_000);
    expect(load.corpusShare).toBeCloseTo(0.32, 6);
    expect(Math.round(load.updatesPerNewDoc)).toBe(33);
    expect(load.fastFieldBytes).toBe(8.64e9);
    expect(load.fastFieldBytesPerShard).toBe(480e6);
  });
});

describe('SearchDuel', () => {
  it('replays the same day for the same scenario', () => {
    const a = run('breaking');
    const b = run('breaking');
    expect(b.events).toEqual(a.events);
    expect(b.lanes[0].recall).toEqual(a.lanes[0].recall);
    expect(b.lanes[1].recall).toEqual(a.lanes[1].recall);
  });

  it('gives a reset run the same day as a fresh run, whatever ran before it', () => {
    const fresh = run('breaking');
    const interrupted = new SearchDuel(searchScenarios.rebuild4h);
    for (let tick = 0; tick < 40; tick += 1) interrupted.step();
    const reset = run('breaking');
    expect(reset.events).toEqual(fresh.events);
    expect(reset.summary(0)).toEqual(fresh.summary(0));
    expect(reset.summary(1)).toEqual(fresh.summary(1));
  });

  it('breaks the three stories at the times the lesson quotes', () => {
    expect(stories.map((story) => clock(story.breakTick))).toEqual(['00:30', '10:30', '18:30']);
  });

  it('feeds every scenario the same documents', () => {
    const docs = run('breaking').docs;
    expect(run('evergreen').docs).toEqual(docs);
    expect(run('rebuild4h').docs).toEqual(docs);
  });

  it('asks a fixed number of queries every tick and records one recall point per tick', () => {
    const duel = run('breaking');
    for (let tick = 0; tick < DAY_TICKS; tick += 1)
      expect(duel.queriesAt(tick)).toHaveLength(QUERIES_PER_TICK);
    expect(duel.lanes[0].recall).toHaveLength(DAY_TICKS);
    expect(duel.lanes[0].queries).toBe(DAY_TICKS * QUERIES_PER_TICK);
  });

  it('accounts for every added document as searchable or pending', () => {
    const duel = new SearchDuel(searchScenarios.breaking);
    for (let tick = 0; tick < 50; tick += 1) {
      duel.step();
      for (const index of [0, 1] as const) {
        const summary = duel.summary(index);
        expect(summary.searchableAdded + summary.pendingAdded).toBe(duel.addedSoFar);
      }
      const laneB = duel.lanes[1];
      expect(laneB.mainDocs + duel.liveDocs(laneB)).toBe(duel.corpusDocs + duel.addedSoFar);
    }
  });

  it('never returns more than the top k, and the oracle never misses its own best result', () => {
    const duel = new SearchDuel(searchScenarios.breaking);
    for (let tick = 0; tick < 30; tick += 1) duel.step();
    const topic = stories[0]?.topic ?? 0;
    expect(duel.ideal(topic, 29).length).toBeLessThanOrEqual(TOP_K);
    expect(duel.ranking(1, topic, 29).length).toBeLessThanOrEqual(TOP_K);
  });

  it('breaking news: the live tier finds fresh stories that the nightly index cannot', () => {
    const duel = run('breaking');
    const [a, b] = [shown(duel.summary(0)), shown(duel.summary(1))];
    expect(a).toEqual({
      recall: 38,
      missedBest: 47,
      unsearchableHours: 9.5,
      segmentsPerQuery: 1,
      builds: 1,
      writes: 1_823,
    });
    expect(b).toEqual({
      recall: 75,
      missedBest: 0,
      unsearchableHours: 0,
      segmentsPerQuery: 5.5,
      builds: 1,
      writes: 2_524,
    });
    expect(duel.summary(1).unsearchableSeconds).toBe(1);
    expect(duel.summary(1).missedBestShare).toBe(0);
    expect(duel.summary(0).pendingAdded).toBe(168);
    expect(Math.round(meanFrom(duel.lanes[0].recall, 42))).toBe(33);
    expect(Math.round(meanFrom(duel.lanes[1].recall, 42))).toBe(77);
    expect(duel.corpusDocs).toBe(1_800);
    expect(duel.docs.length - duel.corpusDocs).toBe(191);
    expect(duel.events.find((event) => event.text.includes('publish the 02:00 build'))?.clock).toBe('05:00');
    expect(duel.events.filter((event) => event.marker).map((event) => event.clock)).toEqual([
      '00:30',
      '05:00',
      '10:30',
      '18:30',
      '19:45',
    ]);
    expect(duel.events.find((event) => event.text.includes('merges'))?.text).toBe(
      'The real-time tier merges 4 level 2 segments into one level 3 segment, rewriting 128 documents.',
    );
    expect(duel.lanes.map((lane) => lane.label)).toEqual(['Nightly rebuild', 'Batch index + real-time tier']);
  });

  it('evergreen catalog: recall ties while the live tier still pays fan-out and writes', () => {
    const duel = run('evergreen');
    const [a, b] = [duel.summary(0), duel.summary(1)];
    expect([Math.round(a.recall), Math.round(b.recall)]).toEqual([95, 97]);
    expect(shown(a)).toMatchObject({ segmentsPerQuery: 1, writes: 1_823 });
    expect(shown(b)).toMatchObject({ segmentsPerQuery: 5.5, writes: 2_524 });
    expect(betterIndex([a.recall, b.recall], 'higher', [`${a.recall}`, `${b.recall}`])).toBe(-1);
    expect(betterIndex([a.segmentsPerQuery, b.segmentsPerQuery], 'lower', ['1', '5.5'])).toBe(0);
    expect(betterIndex([a.writes, b.writes], 'lower', [`${a.writes}`, `${b.writes}`])).toBe(0);
  });

  it('rebuilding every 4 hours freshens the batch-only index but multiplies build work', () => {
    const duel = run('rebuild4h');
    const [a, b] = [shown(duel.summary(0)), shown(duel.summary(1))];
    expect(a).toEqual({
      recall: 49,
      missedBest: 42,
      unsearchableHours: 4.5,
      segmentsPerQuery: 1,
      builds: 6,
      writes: 11_355,
    });
    expect(b.recall).toBe(75);
    expect(Math.round((10 * a.writes) / shown(run('breaking').summary(0)).writes) / 10).toBe(6.2);
    expect(Math.max(...duel.lanes[0].recall.slice(36, 42))).toBe(100);
    expect(
      duel.lanes[0].recall.some((value, tick) => tick > 42 && value > (duel.lanes[1].recall[tick] ?? 100)),
    ).toBe(true);
    expect(duel.lanes[0].label).toBe('Rebuild every 4 hours');
    const publishedA = duel.events.filter((event) =>
      /^(Rebuild every 4 hours:|Both lanes publish)/.test(event.text),
    );
    expect(publishedA.map((event) => event.clock)).toEqual(['05:00', '09:00', '13:00', '17:00', '21:00']);
  });

  it('keeps chart markers few enough to read', () => {
    const counts = (['breaking', 'evergreen', 'rebuild4h'] as const).map(
      (id) => run(id).events.filter((event) => event.marker).length,
    );
    expect(counts).toEqual([5, 5, 9]);
  });

  it('formats indexing delay in the unit that reads best', () => {
    expect(formatDelay(1)).toBe('1 s');
    expect(formatDelay(900)).toBe('15 min');
    expect(formatDelay(34_110)).toBe('9.5 h');
  });

  it('keeps the real-time tier at or above the nightly rebuild at every tick of breaking news', () => {
    const duel = run('breaking');
    const [a, b] = [duel.lanes[0].recall, duel.lanes[1].recall];
    expect(a.every((value, tick) => (b[tick] ?? -1) >= value)).toBe(true);
  });
});

describe('inverted index walkthrough', () => {
  it('drops stopwords and builds sorted posting lists with term frequency', () => {
    expect(tokenize('Storm makes landfall on the coast')).toEqual(['storm', 'makes', 'landfall', 'coast']);
    const postings = buildPostings(miniDocs);
    expect(postings.get('storm')).toEqual([
      { doc: 'd1', tf: 1 },
      { doc: 'd2', tf: 1 },
      { doc: 'd3', tf: 3 },
      { doc: 'd6', tf: 1 },
    ]);
    expect([...postings.keys()]).toEqual([...postings.keys()].sort());
    expect(postings.size).toBe(16);
  });

  it('intersects posting lists and lets keyword stuffing win on text alone', () => {
    const textOnly = searchMini(miniDocs, 'storm coast', false);
    expect(textOnly.matches).toEqual(['d1', 'd2', 'd3']);
    expect(textOnly.results.map((result) => result.doc.id)).toEqual(['d3', 'd1', 'd2']);
    expect(textOnly.results[0]?.text).toBeCloseTo(1.14, 2);
    expect(textOnly.results[1]?.text).toBeCloseTo(0.88, 2);
  });

  it('puts the trusted story first once the offline popularity signal joins the score', () => {
    const withPopularity = searchMini(miniDocs, 'storm coast', true);
    expect(withPopularity.results.map((result) => result.doc.id)).toEqual(['d1', 'd2', 'd3']);
    expect(withPopularity.results.map((result) => Number(result.final.toFixed(2)))).toEqual([
      1.78, 1.48, 1.19,
    ]);
    expect(searchMini(miniDocs, 'storm deals rates', true).results).toEqual([]);
  });
});

describe('typeahead trie', () => {
  const trie = buildTrie(typeaheadLog);

  it('answers a prefix with one node per character plus the root', () => {
    const walk = walkTrie(trie, 'sto');
    expect(walk.found).toBe(true);
    expect(walk.nodesVisited).toBe(4);
    expect(walk.top.map((entry) => entry.query)).toEqual(['storm', 'stock market today', 'storm tracker']);
    expect(walkTrie(trie, 'storm').top.map((entry) => entry.query)).toEqual([
      'storm',
      'storm tracker',
      'storm surge map',
    ]);
  });

  it('matches a full scan of the log, which reads every logged query', () => {
    for (const prefix of ['s', 'st', 'sto', 'storm', 'tr', 'w', 'ra']) {
      const scan = scanLog(typeaheadLog, prefix);
      expect(walkTrie(trie, prefix).top).toEqual(scan.top);
      expect(scan.scanned).toBe(typeaheadLog.length);
    }
  });

  it('stops early on an unknown prefix', () => {
    const walk = walkTrie(trie, 'stx');
    expect(walk).toMatchObject({ found: false, top: [], nodesVisited: 3 });
    expect(typeaheadLog).toHaveLength(16);
    expect(countTrieNodes(trie)).toBeGreaterThan(typeaheadLog.length);
  });
});
