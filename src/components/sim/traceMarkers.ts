export interface MarkerPoint {
  number: number;
  x: number;
}

export interface MarkerLabel {
  kind: 'single' | 'group';
  /** Event numbers in this label, in order. */
  numbers: number[];
  /** Event line positions the connectors run to, one per number. */
  xs: number[];
  /** Center of the badge. */
  x: number;
  width: number;
  /** 0 sits closest to the plot. */
  lane: number;
  text: string;
}

export interface MarkerLayout {
  labels: MarkerLabel[];
  lanes: number;
}

export const BADGE_SIZE = 18;
const LANE_GAP = 2;
const CHAR_WIDTH = 7;

function toLabel(members: MarkerPoint[], minX: number, maxX: number): MarkerLabel {
  const numbers = members.map((member) => member.number);
  const xs = members.map((member) => member.x);
  const single = members.length === 1;
  const text = single ? String(numbers[0]) : `${numbers[0]}-${numbers.at(-1)}`;
  const width = single ? BADGE_SIZE : text.length * CHAR_WIDTH + 14;
  const mean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const half = width / 2;
  const x = Math.min(maxX - half, Math.max(minX + half, mean));
  return { kind: single ? 'single' : 'group', numbers, xs, x, width, lane: 0, text };
}

/**
 * Places numbered badges above a chart. Badges stack into at most `maxLanes` rows; when neighbors still
 * collide they merge into one group label, so every number stays readable and appears exactly once.
 */
export function layoutMarkers(points: MarkerPoint[], minX: number, maxX: number, maxLanes = 2): MarkerLayout {
  if (points.length === 0) return { labels: [], lanes: 1 };
  const sorted = [...points].sort((a, b) => a.x - b.x || a.number - b.number);
  let groups = sorted.map((point) => [point]);

  for (;;) {
    const labels = groups.map((members) => toLabel(members, minX, maxX));
    const laneEnds: number[] = [];
    const failed = labels.findIndex((label) => {
      const left = label.x - label.width / 2;
      for (let lane = 0; lane < maxLanes; lane += 1) {
        const end = laneEnds[lane];
        if (end === undefined || left >= end + LANE_GAP) {
          laneEnds[lane] = label.x + label.width / 2;
          label.lane = lane;
          return false;
        }
      }
      return true;
    });
    if (failed < 0) return { labels, lanes: laneEnds.length };
    const at = Math.max(1, failed);
    const merged = [...(groups[at - 1] ?? []), ...(groups[at] ?? [])];
    groups = [...groups.slice(0, at - 1), merged, ...groups.slice(at + 1)];
  }
}
