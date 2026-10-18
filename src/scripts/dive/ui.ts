// The landing's controls: Dive in, Surface, and the depth gauge. Wired
// whether or not the film runs — with reduced motion or no WebGL the
// buttons still move the reader (instantly) and sound stays available.

import type Lenis from 'lenis';
import type { DiveAudio } from './audio';
import { writeMuted } from './audioMath';

export interface UiOptions {
  /** Read at press time: the film can stop (a lost GPU context) and take
   *  its smooth scroller with it. */
  getLenis(): Lenis | null;
  /** Starts the entry burst, when the film runs. */
  onDiveIn(): void;
  reducedMotion: boolean;
  /** Started by Dive in (browsers block sound until a gesture). */
  audio: DiveAudio;
  /** Where the mute choice is remembered; null when storage is blocked. */
  storage: Pick<Storage, 'setItem'> | null;
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
  const toggle = document.querySelector<HTMLButtonElement>('.sound-toggle');
  const timers: number[] = [];

  const smoothScroller = () => (reducedMotion ? null : opts.getLenis());

  const showSoundState = () => toggle?.setAttribute('aria-pressed', String(!opts.audio.muted));

  const onDiveIn = () => {
    opts.onDiveIn();
    // Synchronously inside the click, so the browser counts it as the
    // gesture that may start sound.
    void opts.audio.start().then(() => opts.audio.cue('splash'));
    if (toggle) {
      toggle.hidden = false;
      showSoundState();
    }
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

  const onToggle = () => {
    opts.audio.setMuted(!opts.audio.muted);
    writeMuted(opts.storage, opts.audio.muted);
    showSoundState();
  };

  diveIn?.addEventListener('click', onDiveIn);
  surface?.addEventListener('click', onSurface);
  toggle?.addEventListener('click', onToggle);
  window.addEventListener('dive:depth', onDepth);

  return () => {
    for (const t of timers) window.clearTimeout(t);
    diveIn?.removeEventListener('click', onDiveIn);
    surface?.removeEventListener('click', onSurface);
    toggle?.removeEventListener('click', onToggle);
    window.removeEventListener('dive:depth', onDepth);
  };
}
