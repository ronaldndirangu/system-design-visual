import { describe, expect, it } from 'vitest';
import {
  FALLBACK_TABLE_NAME,
  type HastNode,
  scrollableTablesPlugin,
  TABLE_SCROLL_CLASS,
  type VisitorContext,
} from '../../src/lib/scrollableTables';

const text = (value: string): HastNode => ({ type: 'text', value });
const el = (tagName: string, properties: Record<string, unknown> = {}, children: HastNode[] = []) => ({
  type: 'element',
  tagName,
  properties,
  children,
});
const table = (...children: HastNode[]) => el('table', {}, [...children, el('tbody', {}, [el('tr')])]);
const root = (...children: HastNode[]): HastNode => ({ type: 'root', children });

/** Runs the plugin the way Sätteri does: each table visited once, with parent and index lookups. */
function run(tree: HastNode): HastNode {
  const parents = new Map<HastNode, HastNode>();
  const tables: HastNode[] = [];
  const index = (node: HastNode) => {
    for (const child of node.children ?? []) {
      parents.set(child, node);
      if (child.type === 'element' && child.tagName === 'table') tables.push(child);
      index(child);
    }
  };
  index(tree);
  const ctx: VisitorContext = {
    parent: (node) => parents.get(node),
    indexOf: (node) => parents.get(node)?.children?.indexOf(node),
    wrapNode(node, wrapper) {
      const parent = parents.get(node);
      if (!parent?.children) throw new Error('cannot wrap the root');
      wrapper.children = [node, ...(wrapper.children ?? [])];
      parent.children[parent.children.indexOf(node)] = wrapper;
      parents.set(wrapper, parent);
      parents.set(node, wrapper);
    },
  };
  const { visit } = scrollableTablesPlugin().element;
  for (const node of tables) visit(node, ctx);
  return tree;
}

function regions(node: HastNode): HastNode[] {
  const own = node.properties?.class === TABLE_SCROLL_CLASS ? [node] : [];
  return [...own, ...(node.children ?? []).flatMap(regions)];
}

const nameOf = (tree: HastNode) => regions(run(tree)).map((region) => region.properties?.['aria-label']);

describe('scrollableTablesPlugin', () => {
  it('wraps the table, untouched, in a focusable named region', () => {
    const grid = table();
    const tree = run(root(el('h2', {}, [text('Costs')]), grid));

    expect(tree.children?.[1]).toEqual({
      type: 'element',
      tagName: 'div',
      properties: { class: TABLE_SCROLL_CLASS, tabindex: '0', role: 'region', 'aria-label': 'Costs' },
      children: [grid],
    });
    expect(tree.children?.[1]?.children?.[0]).toBe(grid);
  });

  it('prefers the caption and collapses its whitespace', () => {
    const tree = root(
      el('h2', {}, [text('Heading')]),
      table(el('caption', {}, [text(' Cost  per\nstage ')])),
    );
    expect(nameOf(tree)).toEqual(['Cost per stage']);
  });

  it('names a table inside a TradeoffTable after its title', () => {
    const tradeoff: HastNode = {
      type: 'mdxJsxFlowElement',
      name: 'TradeoffTable',
      attributes: [{ type: 'mdxJsxAttribute', name: 'title', value: 'Designing a recommendation funnel' }],
      children: [table()],
    };
    expect(nameOf(root(el('h2', {}, [text('Heading')]), tradeoff))).toEqual([
      'Designing a recommendation funnel',
    ]);
  });

  it("reads Starlight's heading wrapper, skipping the anchor link, from an outer level", () => {
    const heading = el('div', { class: 'sl-heading-wrapper level-h3' }, [
      el('h3', { id: 'where' }, [text('Where the '), el('code', {}, [text('time')]), text(' goes')]),
      el('a', { class: 'sl-anchor-link', href: '#where' }, [
        el('span', { class: 'sr-only' }, [text('Section titled “Where the time goes”')]),
      ]),
    ]);
    expect(nameOf(root(heading, el('section', {}, [el('p', {}, [text('Intro')]), table()])))).toEqual([
      'Where the time goes',
    ]);
  });

  it('ignores headings nested inside earlier siblings', () => {
    const aside = el('aside', {}, [el('h3', {}, [text('Aside title')])]);
    expect(nameOf(root(el('h2', {}, [text('Section')]), aside, table()))).toEqual(['Section']);
  });

  it('falls back when no heading carries text', () => {
    expect(nameOf(root(el('p', {}, [text('Lead')]), table()))).toEqual([FALLBACK_TABLE_NAME]);
    const expressionOnly = el('h2', {}, [{ type: 'mdxTextExpression', value: 'title' }]);
    expect(nameOf(root(expressionOnly, table()))).toEqual([FALLBACK_TABLE_NAME]);
  });

  it('leaves an already wrapped table alone', () => {
    const tree = root(el('h2', {}, [text('A')]), table(), el('h2', {}, [text('B')]), table());
    run(tree);
    expect(nameOf(tree)).toEqual(['A', 'B']);
    expect(regions(tree).map((region) => region.children?.length)).toEqual([1, 1]);
  });
});
