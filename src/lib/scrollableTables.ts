import type { AstroIntegration } from 'astro';

/** The smallest slice of hast (plus MDX JSX nodes) this plugin reads. */
export interface HastNode {
  type: string;
  tagName?: string;
  name?: string | null;
  value?: unknown;
  properties?: Record<string, unknown>;
  attributes?: Array<{ type: string; name?: string; value?: unknown }>;
  children?: HastNode[];
}

/** The navigation half of Sätteri's hast visitor context. */
export interface TreeAccess {
  parent(node: HastNode): HastNode | undefined;
  indexOf(node: HastNode): number | undefined;
}

export interface VisitorContext extends TreeAccess {
  wrapNode(node: HastNode, wrapper: HastNode): void;
}

export const TABLE_SCROLL_CLASS = 'sdv-table-scroll';
export const FALLBACK_TABLE_NAME = 'Scrollable table';

const HEADING = /^h[1-6]$/;
const HIDDEN_TEXT_CLASSES = ['sr-only', 'sl-anchor-link'];

/**
 * Registers the table wrapper with Astro's default Sätteri Markdown processor, the same way
 * Starlight registers its own hast plugins.
 */
export function scrollableTables(): AstroIntegration {
  return {
    name: 'sdv-scrollable-tables',
    hooks: {
      'astro:config:setup': ({ config, logger }) => {
        const processor = config.markdown?.processor;
        if (processor?.name !== 'satteri') {
          logger.warn(`Tables stay unwrapped: the "${processor?.name}" Markdown processor is unsupported.`);
          return;
        }
        (processor.options as { hastPlugins: unknown[] }).hastPlugins.push(scrollableTablesPlugin());
      },
    },
  };
}

/**
 * Wraps every markdown table in a named, keyboard-focusable scroll region so wide tables can scroll
 * sideways without failing axe's scrollable-region-focusable rule.
 */
export function scrollableTablesPlugin() {
  return {
    name: 'sdv-scrollable-tables',
    element: {
      filter: ['table'],
      visit(table: HastNode, ctx: VisitorContext): void {
        const parent = ctx.parent(table);
        if (parent && hasClass(parent, TABLE_SCROLL_CLASS)) return;
        ctx.wrapNode(table, scrollRegion(tableRegionName(table, ctx)));
      },
    },
  };
}

export function scrollRegion(name: string): HastNode {
  return {
    type: 'element',
    tagName: 'div',
    properties: { class: TABLE_SCROLL_CLASS, tabindex: '0', role: 'region', 'aria-label': name },
    children: [],
  };
}

/** Name precedence: the table caption, a TradeoffTable title, the nearest preceding heading, a fallback. */
export function tableRegionName(table: HastNode, tree: TreeAccess): string {
  const caption = table.children?.find((child) => isElement(child, 'caption'));
  return (
    (caption && textOf(caption)) ||
    tradeoffTitle(table, tree) ||
    precedingHeading(table, tree) ||
    FALLBACK_TABLE_NAME
  );
}

function tradeoffTitle(node: HastNode, tree: TreeAccess): string {
  for (let ancestor = tree.parent(node); ancestor; ancestor = tree.parent(ancestor)) {
    if (ancestor.type !== 'mdxJsxFlowElement' || ancestor.name !== 'TradeoffTable') continue;
    const title = ancestor.attributes?.find(
      (attribute) => attribute.type === 'mdxJsxAttribute' && attribute.name === 'title',
    );
    return typeof title?.value === 'string' ? collapse(title.value) : '';
  }
  return '';
}

/** Walk back through earlier siblings, then the earlier siblings of each ancestor, until a heading turns up. */
function precedingHeading(node: HastNode, tree: TreeAccess): string {
  for (
    let current = node, parent = tree.parent(node);
    parent;
    current = parent, parent = tree.parent(parent)
  ) {
    const siblings = parent.children ?? [];
    for (let at = (tree.indexOf(current) ?? 0) - 1; at >= 0; at--) {
      const sibling = siblings[at];
      const heading = sibling && asHeading(sibling);
      const name = heading ? textOf(heading) : '';
      if (name) return name;
    }
  }
  return '';
}

/** A heading element, or the heading inside Starlight's anchor-link wrapper. */
function asHeading(node: HastNode): HastNode | undefined {
  if (node.type === 'element' && HEADING.test(node.tagName ?? '')) return node;
  if (isElement(node, 'div') && hasClass(node, 'sl-heading-wrapper')) {
    return node.children?.find((child) => child.type === 'element' && HEADING.test(child.tagName ?? ''));
  }
  return undefined;
}

function textOf(node: HastNode): string {
  return collapse(rawText(node));
}

function rawText(node: HastNode): string {
  if (node.type === 'text') return typeof node.value === 'string' ? node.value : '';
  if (node.type === 'element' && HIDDEN_TEXT_CLASSES.some((name) => hasClass(node, name))) return '';
  if (node.type === 'mdxTextExpression' || node.type === 'mdxFlowExpression') return '';
  return (node.children ?? []).map(rawText).join('');
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isElement(node: HastNode, tagName: string): boolean {
  return node.type === 'element' && node.tagName === tagName;
}

/** Sätteri keys classes as `class`; hast elsewhere uses `className`. Either may be a string or a list. */
function hasClass(node: HastNode, name: string): boolean {
  const value = node.properties?.class ?? node.properties?.className;
  const classes = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\s+/) : [];
  return classes.includes(name);
}
