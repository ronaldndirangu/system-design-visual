/** Joins each number to the word after it with a no-break space, so "250 ms" never wraps between the two. */
export function keepNumbersWithWords(text: string): string {
  return text.replace(/(\d) +(?=\S)/g, '$1\u00a0');
}
