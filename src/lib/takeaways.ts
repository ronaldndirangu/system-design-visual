const BLOCK = /<KeyTakeaways[^>]*>([\s\S]*?)<\/KeyTakeaways>/;

/** The bullet text inside a lesson's `<KeyTakeaways>` block, one string per bullet. */
export function extractTakeaways(source: string): string[] {
  const block = BLOCK.exec(source.replaceAll('\r\n', '\n'))?.[1];
  if (!block) return [];
  const bullets: string[] = [];
  for (const line of block.split('\n')) {
    const start = /^[-*] +(.*)$/.exec(line);
    if (start) bullets.push((start[1] as string).trim());
    else if (line.trim() && /^\s/.test(line) && bullets.length > 0) {
      bullets[bullets.length - 1] += ` ${line.trim()}`;
    }
  }
  return bullets;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** Inline Markdown to safe HTML: code spans, bold, and italics survive; links keep only their text. */
export function inlineMarkdown(text: string): string {
  return text
    .replace(/[&<>"]/g, (char) => ESCAPES[char] as string)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}
