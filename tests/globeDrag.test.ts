import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  reduced: false,
  tween: null as null | { vars: { px: number; onUpdate: () => void; onComplete: () => void }; target: { px: number }; killed: boolean },
}));

vi.mock('gsap', () => ({
  default: {
    matchMedia: () => {
      let cleanup: void | (() => void);
      return {
        add: (_query: string, fn: () => void | (() => void)) => {
          if (!fake.reduced) cleanup = fn();
        },
        revert: () => cleanup?.(),
      };
    },
    to: (target: { px: number }, vars: { px: number; onUpdate: () => void; onComplete: () => void }) => {
      const tween = { vars, target, killed: false, kill: () => { tween.killed = true; } };
      fake.tween = tween;
      return tween;
    },
  },
}));

import { attachGlobeDrag } from '../components/marketing/earth/globeDrag';

class FakeElement extends EventTarget {
  constructor(private readonly blocked = false) {
    super();
  }
  closest() {
    return this.blocked ? this : null;
  }
}

function pointer(type: string, id: number, x: number, y: number, timeStamp: number, extra: Record<string, unknown> = {}) {
  const e = new Event(type, { bubbles: true });
  Object.defineProperties(e, { timeStamp: { value: timeStamp } });
  return Object.assign(e, { pointerId: id, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, ...extra });
}

describe('globe touch drag', () => {
  let surface: FakeElement & { style: { touchAction: string } };
  let win: EventTarget & { visualViewport: null | (EventTarget & { scale: number }) };
  const globe = { dragBy: vi.fn(), setHeld: vi.fn() };
  const lastHeld = () => globe.setHeld.mock.calls.at(-1)?.[0];
  const dragged = () => globe.dragBy.mock.calls.reduce((sum, [dx]) => sum + dx, 0);

  const drag = (id = 1) => {
    surface.dispatchEvent(pointer('pointerdown', id, 100, 300, 0));
    win.dispatchEvent(pointer('pointermove', id, 120, 300, 16));
    win.dispatchEvent(pointer('pointermove', id, 160, 300, 32));
  };

  beforeEach(() => {
    fake.reduced = false;
    fake.tween = null;
    globe.dragBy.mockClear();
    globe.setHeld.mockClear();
    surface = Object.assign(new FakeElement(), { style: { touchAction: '' } });
    win = Object.assign(new EventTarget(), { visualViewport: null });
    vi.stubGlobal('window', win);
    vi.stubGlobal('Element', FakeElement);
  });
  afterEach(() => vi.unstubAllGlobals());

  const attach = () => attachGlobeDrag(surface as unknown as HTMLElement, globe);

  it('leaves vertical scrolling and pinch to the browser, and restores the page on detach', () => {
    const detach = attach();
    expect(surface.style.touchAction).toBe('pan-y pinch-zoom');
    detach();
    expect(surface.style.touchAction).toBe('');
  });

  it('follows the finger from where it first touched, with no lag from the slop', () => {
    attach();
    drag();
    expect(lastHeld()).toBe(true);
    expect(dragged()).toBe(60);
  });

  it('ignores vertical swipes and mouse input', () => {
    attach();
    surface.dispatchEvent(pointer('pointerdown', 1, 100, 300, 0));
    win.dispatchEvent(pointer('pointermove', 1, 102, 330, 16));
    win.dispatchEvent(pointer('pointermove', 1, 180, 330, 32));
    surface.dispatchEvent(pointer('pointerdown', 2, 100, 300, 40, { pointerType: 'mouse' }));
    win.dispatchEvent(pointer('pointermove', 2, 180, 300, 56));
    expect(globe.dragBy).not.toHaveBeenCalled();
    expect(globe.setHeld).not.toHaveBeenCalled();
  });

  it('leaves drags that start on a control or a scroller alone', () => {
    attach();
    const control = new FakeElement(true);
    const e = pointer('pointerdown', 1, 100, 300, 0);
    Object.defineProperty(e, 'target', { value: control });
    surface.dispatchEvent(e);
    win.dispatchEvent(pointer('pointermove', 1, 180, 300, 16));
    expect(globe.dragBy).not.toHaveBeenCalled();
  });

  it('never leaves the globe held after a cancel', () => {
    attach();
    drag();
    win.dispatchEvent(pointer('pointercancel', 1, 160, 300, 40));
    expect(lastHeld()).toBe(false);
    expect(fake.tween).toBeNull();
  });

  it('lets go on a second finger and ignores the rest of that pinch', () => {
    attach();
    drag();
    surface.dispatchEvent(pointer('pointerdown', 2, 200, 300, 40, { isPrimary: false }));
    expect(lastHeld()).toBe(false);
    globe.dragBy.mockClear();
    win.dispatchEvent(pointer('pointermove', 1, 220, 300, 56));
    win.dispatchEvent(pointer('pointerup', 1, 220, 300, 72));
    expect(globe.dragBy).not.toHaveBeenCalled();
    expect(fake.tween).toBeNull();
  });

  it('recovers on the next swipe when a gesture end never arrives', () => {
    attach();
    drag();
    globe.dragBy.mockClear();
    drag(2);
    expect(dragged()).toBe(60);
    expect(lastHeld()).toBe(true);
  });

  it('flings on a fast release and only lets go when the fling ends', () => {
    attach();
    drag();
    win.dispatchEvent(pointer('pointerup', 1, 160, 300, 40));
    const tween = fake.tween!;
    expect(tween.vars.px).toBeGreaterThan(0);
    expect(lastHeld()).toBe(true);
    globe.dragBy.mockClear();
    tween.target.px = 30;
    tween.vars.onUpdate();
    expect(globe.dragBy).toHaveBeenCalledWith(30);
    tween.vars.onComplete();
    expect(lastHeld()).toBe(false);
  });

  it('stops a fling on the next touch and on detach', () => {
    const detach = attach();
    drag();
    win.dispatchEvent(pointer('pointerup', 1, 160, 300, 40));
    const first = fake.tween!;
    surface.dispatchEvent(pointer('pointerdown', 2, 100, 300, 60));
    expect(first.killed).toBe(true);
    expect(lastHeld()).toBe(false);
    win.dispatchEvent(pointer('pointerup', 2, 100, 300, 80));
    drag(3);
    win.dispatchEvent(pointer('pointerup', 3, 160, 300, 40));
    const second = fake.tween!;
    detach();
    expect(second.killed).toBe(true);
    expect(lastHeld()).toBe(false);
  });

  it('does not fling after the finger has rested, or under reduced motion', () => {
    const detach = attach();
    drag();
    win.dispatchEvent(pointer('pointerup', 1, 160, 300, 500));
    expect(fake.tween).toBeNull();
    expect(lastHeld()).toBe(false);
    detach();

    fake.reduced = true;
    attach();
    drag(2);
    win.dispatchEvent(pointer('pointerup', 2, 160, 300, 40));
    expect(fake.tween).toBeNull();
    expect(lastHeld()).toBe(false);
  });

  it('stands down while the page is zoomed in', () => {
    const viewport = Object.assign(new EventTarget(), { scale: 1 });
    win.visualViewport = viewport;
    attach();
    expect(surface.style.touchAction).toBe('pan-y pinch-zoom');
    viewport.scale = 2;
    viewport.dispatchEvent(new Event('resize'));
    expect(surface.style.touchAction).toBe('');
    drag();
    expect(globe.dragBy).not.toHaveBeenCalled();
    viewport.scale = 1;
    viewport.dispatchEvent(new Event('resize'));
    expect(surface.style.touchAction).toBe('pan-y pinch-zoom');
  });
});
