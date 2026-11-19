/**
 * Plays concept figures: dots travel their `data-path` during `data-at`, and `data-show`
 * content appears during its window. Each figure's static markup is the final frame,
 * so with no script, reduced motion, or after the last loop, the picture still tells the story.
 */

const LOOP_MS = 6500;
const LOOPS = 3;
const FADE = 0.02;
const IN_VIEW = 0.35;

type Point = [number, number];

function windowOf(raw: string | undefined): [number, number] {
  const [a = 0, b = 1] = (raw ?? '').split(' ').map(Number);
  return [clamp(a), clamp(b)];
}

function clamp(offset: number): number {
  return Math.min(Math.max(offset, 0), 1);
}

function translate([x, y]: Point): string {
  return `translate(${x}px, ${y}px)`;
}

export function dotFrames(path: string, at: string): Keyframe[] {
  const points = path.split(' ').map((pair) => pair.split(',').map(Number) as Point);
  const [a, b] = windowOf(at);
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1] as Point;
    const [x1, y1] = points[i] as Point;
    lengths.push((lengths[i - 1] ?? 0) + Math.hypot(x1 - x0, y1 - y0));
  }
  const total = lengths[lengths.length - 1] || 1;
  const first = points[0] as Point;
  const last = points[points.length - 1] as Point;
  const frames: Keyframe[] = [{ offset: 0, opacity: 0, transform: translate(first) }];
  if (a > 0) frames.push({ offset: a, opacity: 0, transform: translate(first) });
  points.forEach((point, i) => {
    frames.push({
      // Rounding can push the last point a hair past b, which makes the browser reject every frame.
      offset: Math.min(b, a + ((b - a) * (lengths[i] ?? 0)) / total),
      opacity: 1,
      transform: translate(point),
    });
  });
  frames.push({ offset: b, opacity: 0, transform: translate(last) });
  if (b < 1) frames.push({ offset: 1, opacity: 0, transform: translate(last) });
  return frames;
}

export function showFrames(at: string, low = 0): Keyframe[] {
  const [a, b] = windowOf(at);
  const frames: Keyframe[] = [];
  if (a > 0) {
    frames.push(
      { offset: 0, opacity: low },
      { offset: a, opacity: low },
      { offset: Math.min(a + FADE, b), opacity: 1 },
    );
  } else {
    frames.push({ offset: 0, opacity: 1 });
  }
  if (b < 1) {
    frames.push(
      { offset: b, opacity: 1 },
      { offset: Math.min(b + FADE, 1), opacity: low },
      { offset: 1, opacity: low },
    );
  } else {
    frames.push({ offset: 1, opacity: 1 });
  }
  return frames;
}

function bind(figure: HTMLElement, reduce: MediaQueryList) {
  figure.dataset.ready = '';
  const toggle = figure.querySelector<HTMLButtonElement>('[data-action="toggle"]');
  const replay = figure.querySelector<HTMLButtonElement>('[data-action="replay"]');
  const previous = figure.querySelector<HTMLButtonElement>('[data-action="previous"]');
  const next = figure.querySelector<HTMLButtonElement>('[data-action="next"]');
  const status = figure.querySelector<HTMLElement>('[data-step-status]');
  let animations: Animation[] = [];
  let userPaused = false;
  let inView = false;
  let step = -1;

  const activeRoot = () => {
    const state = figure.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value ?? 'without';
    return figure.querySelector<HTMLElement>(`[data-state="${state}"]`);
  };
  const paintStep = () => {
    const captions = activeRoot()?.querySelectorAll<HTMLElement>('.sdv-concept__captions li');
    figure.querySelectorAll('[data-current-step]').forEach((item) => {
      item.removeAttribute('data-current-step');
    });
    captions?.[step]?.setAttribute('data-current-step', '');
    if (previous) previous.disabled = step <= 0;
    if (next) next.disabled = step >= (captions?.length ?? 3) - 1;
    if (status)
      status.textContent = step < 0 ? 'Read at your pace' : `Step ${step + 1} of ${captions?.length ?? 3}`;
  };

  const running = () => animations.length > 0;
  const canRun = () => inView && !document.hidden;

  const sync = () => {
    const paused = !running() || userPaused;
    figure.toggleAttribute('data-paused', paused);
    toggle?.setAttribute('aria-label', paused ? 'Play animation' : 'Pause animation');
  };

  const stop = () => {
    for (const animation of animations) animation.cancel();
    animations = [];
    figure.removeAttribute('data-playing');
  };

  const hold = () => {
    for (const animation of animations) animation.pause();
  };

  const resume = () => {
    if (userPaused || !canRun()) return;
    for (const animation of animations) animation.play();
  };

  const start = (at?: number) => {
    stop();
    if (reduce.matches) return sync();
    const root = activeRoot();
    if (!root) return sync();
    const timing: KeyframeAnimationOptions = { duration: LOOP_MS, iterations: LOOPS, easing: 'linear' };
    const batch: Animation[] = [];
    for (const dot of root.querySelectorAll<SVGElement>('[data-path]')) {
      batch.push(dot.animate(dotFrames(dot.dataset.path ?? '', dot.dataset.at ?? ''), timing));
    }
    for (const part of root.querySelectorAll<SVGElement>('svg [data-show]')) {
      batch.push(part.animate(showFrames(part.dataset.show ?? ''), timing));
    }
    const markers = root.querySelectorAll<SVGElement>('.sdv-concept__marker');
    root.querySelectorAll<HTMLElement>('.sdv-concept__captions li').forEach((item, i) => {
      const at = markers[i]?.dataset.show;
      if (at) {
        const frames = showFrames(at).map(({ offset, opacity }) => ({
          offset,
          color: opacity === 1 ? 'var(--sdv-text-1)' : 'var(--sdv-text-3)',
        }));
        batch.push(item.animate(frames, timing));
      }
    });
    animations = batch;
    figure.setAttribute('data-playing', '');
    Promise.all(batch.map((animation) => animation.finished)).then(
      () => {
        if (animations !== batch) return;
        animations = [];
        figure.removeAttribute('data-playing');
        step = -1;
        paintStep();
        sync();
      },
      () => {},
    );
    if (at !== undefined) {
      for (const animation of animations) animation.currentTime = at * LOOP_MS;
    }
    if (userPaused || !canRun()) hold();
    sync();
  };

  const play = () => {
    step = -1;
    paintStep();
    userPaused = false;
    start();
  };

  const seek = (value: number) => {
    const root = activeRoot();
    const markers = root?.querySelectorAll<SVGElement>('.sdv-concept__marker');
    if (!markers?.length) return;
    step = Math.max(0, Math.min(markers.length - 1, value));
    const [a, end] = windowOf(markers[step]?.dataset.show);
    // Markers stay visible to the end; the next marker bounds this teaching step.
    const b = markers[step + 1] ? windowOf(markers[step + 1]?.dataset.show)[0] : end;
    userPaused = true;
    start((a + b) / 2);
    paintStep();
  };
  previous?.addEventListener('click', () => seek(step - 1));
  next?.addEventListener('click', () => seek(step + 1));

  toggle?.addEventListener('click', () => {
    if (!running()) {
      play();
      return;
    }
    step = -1;
    paintStep();
    userPaused = !userPaused;
    if (userPaused) hold();
    else resume();
    sync();
  });

  replay?.addEventListener('click', play);

  figure.addEventListener('change', (event) => {
    if (!(event.target instanceof HTMLInputElement) || event.target.type !== 'radio') return;
    step = -1;
    paintStep();
    if (userPaused || !running()) {
      stop();
      sync();
    } else {
      start();
    }
  });

  new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        inView = entry.intersectionRatio >= IN_VIEW;
        if (!inView) hold();
        else resume();
      }
    },
    { threshold: [0, IN_VIEW] },
  ).observe(figure);

  document.addEventListener('visibilitychange', () => (document.hidden ? hold() : resume()));
  reduce.addEventListener('change', () => {
    if (!reduce.matches) return;
    stop();
    sync();
  });
  paintStep();
  sync();
}

export function setupConceptFigures() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  for (const figure of document.querySelectorAll<HTMLElement>('[data-concept]:not([data-ready])')) {
    bind(figure, reduce);
  }
}
