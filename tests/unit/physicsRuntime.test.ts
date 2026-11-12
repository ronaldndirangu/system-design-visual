import { describe, expect, it } from 'vitest';
import {
  advanceScene,
  loadMatter,
  loopDelta,
  MAX_FRAME_MS,
  type Matter,
  physicsStatus,
} from '../../src/components/physics/runtime';

function recorder() {
  const calls: number[] = [];
  return { calls, scene: { frame: (dt: number) => calls.push(dt) } };
}

const running = { visible: true, hidden: false, paused: false, speed: 1 };

describe('loopDelta', () => {
  it('holds the engine still while paused, hidden, or off screen', () => {
    expect(loopDelta(16, { ...running, paused: true })).toBe(0);
    expect(loopDelta(16, { ...running, hidden: true })).toBe(0);
    expect(loopDelta(16, { ...running, visible: false })).toBe(0);
  });

  it('scales elapsed time by the playback speed and caps a slow frame', () => {
    expect(loopDelta(16, running)).toBe(16);
    expect(loopDelta(16, { ...running, speed: 2 })).toBe(32);
    expect(loopDelta(500, running)).toBe(MAX_FRAME_MS);
    expect(loopDelta(500, { ...running, speed: 4 })).toBe(MAX_FRAME_MS * 4);
  });
});

describe('advanceScene', () => {
  it('advances one Step tick in stable slices', () => {
    const { calls, scene } = recorder();
    advanceScene(scene, 100);
    expect(calls).toEqual([50, 50]);
  });

  it('splits an uneven span and keeps the remainder', () => {
    const { calls, scene } = recorder();
    advanceScene(scene, 120);
    expect(calls).toEqual([50, 50, 20]);
  });

  it('does not touch the scene when paused time is zero', () => {
    const { calls, scene } = recorder();
    advanceScene(scene, loopDelta(16, { ...running, paused: true }));
    expect(calls).toEqual([]);
  });
});

describe('physicsStatus', () => {
  it('reports each state the fallback depends on', () => {
    expect(physicsStatus({ enabled: false, error: true, ready: false })).toBe('off');
    expect(physicsStatus({ enabled: true, error: false, ready: false })).toBe('loading');
    expect(physicsStatus({ enabled: true, error: false, ready: true })).toBe('ready');
    expect(physicsStatus({ enabled: true, error: true, ready: false })).toBe('failed');
  });
});

describe('loadMatter', () => {
  it('forgets a failed load so Retry can load again', async () => {
    const engine = {} as Matter;
    let attempts = 0;
    const flaky = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('network');
      return { default: engine };
    };
    await expect(loadMatter(flaky)).rejects.toThrow('network');
    await expect(loadMatter(flaky)).resolves.toBe(engine);
    await expect(loadMatter(flaky)).resolves.toBe(engine);
    expect(attempts).toBe(2);
  });
});
