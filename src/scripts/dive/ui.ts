// The landing's controls: Dive in, Surface, and the depth gauge. Wired
// whether or not the film runs — with reduced motion or no WebGL the
// buttons still move the reader (instantly) and sound stays available.

import type Lenis from 'lenis';

export interface UiOptions {
  /** Read at press time: the film can stop (a lost GPU context) and take
   *  its smooth scroller with it. */
  getLenis(): Lenis | null;
  /** Starts the entry burst (when the film runs) and the sound. */
  onDiveIn(): void;
  reducedMotion: boolean;
}

// The burst plays before the camera starts down (index.ts ENTRY_S).
const ENTRY_S = 1.2;
const DIVE_SCROLL_S = 2.4;
const SURFACE_SCROLL_S = 4;

/** Scroll position at which a station's centre meets the viewport's —
 *  where progress.ts pins it to its depth. */
function centreOn(el: HTMLElement): number {
  return Math.max(0, el.offsetTop + el.offsetHeight / 2 - window.innerHeight / 2);
}

export function wireUi(opts: UiOptions): () => void {
  const { reducedMotion } = opts;
  const diveIn = document.querySelector<HTMLButtonElement>('.dive-in');
  const surface = document.querySelector<HTMLButtonElement>('.surface');
  const about = document.getElementById('about');
  const title = document.querySelector<HTMLElement>('.title-h1');
  const gauge = document.querySelector<HTMLElement>('.depth-gauge');
  const reading = gauge?.querySelector<HTMLElement>('[data-depth]');
  const timers: number[] = [];

  const smoothScroller = () => (reducedMotion ? null : opts.getLenis());

  const onDiveIn = () => {
    opts.onDiveIn();
    if (!about) return;
    const land = () => about.focus({ preventScroll: true });
    if (smoothScroller()) {
      timers.push(
        window.setTimeout(() => {
          const lenis = smoothScroller();
          if (lenis) lenis.scrollTo(centreOn(about), { duration: DIVE_SCROLL_S, onComplete: land });
          else {
            window.scrollTo(0, centreOn(about));
            land();
          }
        }, ENTRY_S * 1000),
      );
    } else {
      window.scrollTo(0, centreOn(about));
      land();
    }
  };

  const onSurface = () => {
    const land = () => title?.focus({ preventScroll: true });
    const lenis = smoothScroller();
    if (lenis) lenis.scrollTo(0, { duration: SURFACE_SCROLL_S, onComplete: land });
    else {
      window.scrollTo(0, 0);
      land();
    }
  };

  // The gauge only means something while the film runs.
  let shown = '';
  const onDepth = (e: Event) => {
    if (!gauge || !reading) return;
    gauge.hidden = !document.documentElement.classList.contains('has-dive');
    const text = String(Math.round((e as CustomEvent<{ metres: number }>).detail.metres));
    if (text !== shown) {
      shown = text;
      reading.textContent = text;
    }
  };

  diveIn?.addEventListener('click', onDiveIn);
  surface?.addEventListener('click', onSurface);
  window.addEventListener('dive:depth', onDepth);

  return () => {
    for (const t of timers) window.clearTimeout(t);
    diveIn?.removeEventListener('click', onDiveIn);
    surface?.removeEventListener('click', onSurface);
    window.removeEventListener('dive:depth', onDepth);
  };
}
