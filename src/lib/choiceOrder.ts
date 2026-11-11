import { createRng, hashString } from './rng';

function shuffled(seed: string, count: number): number[] {
  const rng = createRng(hashString(seed));
  const order = Array.from({ length: count }, (_, index) => index);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = order[i] as number;
    order[i] = order[j] as number;
    order[j] = swap;
  }
  return order;
}

function sameOrder(a: number[], b: number[]): boolean {
  return a.every((value, index) => value === b[index]);
}

/**
 * Display order for a question's options, as indexes into the authored list.
 * A pure function of the question id and attempt number: the server and the
 * browser agree on attempt 0, and every retry shows a different order.
 * Ordered options (a scale such as 1, 10, 100) keep their sequence; the seed
 * only picks ascending or descending, and each retry flips the direction.
 */
export function choiceOrder(id: string, attempt: number, count: number, ordered = false): number[] {
  if (ordered) {
    const ascending = Array.from({ length: count }, (_, index) => index);
    const flip = (hashString(`${id}#direction`) + attempt) % 2 === 1;
    return flip ? ascending.reverse() : ascending;
  }
  let order = shuffled(`${id}#0`, count);
  if (count < 2) return order;
  for (let a = 1; a <= attempt; a++) {
    let next = shuffled(`${id}#${a}#0`, count);
    for (let salt = 1; sameOrder(next, order); salt++) {
      next = shuffled(`${id}#${a}#${salt}`, count);
    }
    order = next;
  }
  return order;
}
