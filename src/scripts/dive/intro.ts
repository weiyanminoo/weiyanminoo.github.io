// The intro: a first visit opens on the dive boat, before the dive. A still
// of the sea from the boat, Wei Yan's name, "Personal portfolio" and Dive
// in. Dive in plays his own clip of the giant stride off the boat; its last
// 0.8 s crossfade into the film at the surface, and the descent carries on
// into About, as the title's own Dive in does. The film builds behind all
// of it, and the clip downloads only once the film's first water is up.
//
// Whether it shows at all is decided before first paint, by DiveLayout's
// inline script (html.intro): never for a returning visitor, a link into a
// section, reduced motion or Save-Data. Without that class this does
// nothing. Scrolling on the first screen starts the clip too, silently
// (browsers do not count a scroll as a press that may start sound); the
// sound toggle shows it as off and turns it on.

import type { DiveAudio } from './audio';
import type { UiHandle } from './ui';

/** Also read by DiveLayout's inline script: keep the two in step. */
export const INTRO_SEEN_KEY = 'dive:intro-seen';
// The crossfade into the film: the clip's last 0.8 s, which
// .scratch/intro-encode.sh grades toward the film's own colour.
const FADE_S = 0.8;
// A clip that has not started this long after Dive in (a stalled download)
// is given up on: the dive goes on without it.
const START_TIMEOUT_MS = 6000;
// If the film never reports its first water (no WebGL, a slow build), the
// clip starts downloading anyway after this.
const PRELOAD_FALLBACK_MS = 2500;
const SCROLL_KEYS = new Set([' ', 'Spacebar', 'PageDown', 'ArrowDown', 'Down', 'End']);

export interface IntroOptions {
  audio: DiveAudio;
  ui: UiHandle;
  storage: Pick<Storage, 'setItem'> | null;
}

declare global {
  interface Window {
    __introReady?: boolean;
  }
}

export function runIntro(opts: IntroOptions): void {
  const html = document.documentElement;
  if (!html.classList.contains('intro')) return;
  // DiveLayout's fail-safe drops the intro if this never runs; it has.
  window.__introReady = true;

  const gate = document.querySelector<HTMLElement>('.intro-gate');
  const video = gate?.querySelector<HTMLVideoElement>('.intro-clip');
  const inner = gate?.querySelector<HTMLElement>('.intro-inner');
  const diveBtn = gate?.querySelector<HTMLButtonElement>('.intro-dive');
  const skipBtn = gate?.querySelector<HTMLButtonElement>('.intro-skip');
  const main = document.querySelector('main');
  if (!gate || !video || !inner || !diveBtn || !skipBtn || !main) {
    html.classList.remove('intro');
    return;
  }
  const toggle = document.querySelector<HTMLButtonElement>('.sound-toggle');
  const title = document.querySelector<HTMLElement>('.title-h1');

  // Everything behind the first screen is out of reach until it goes; the
  // menu above it stays live.
  const behind = [...main.children].filter((el): el is HTMLElement => el !== gate && el instanceof HTMLElement);
  for (const el of behind) el.inert = true;
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  let phase: 'gate' | 'clip' | 'out' | 'done' = 'gate';
  let startTimer = 0;

  // The copy is laid out like the title's, but the line under the name
  // differs (it wraps on a phone where the title's does not, or the other
  // way), which moves a centred block. So the name is pinned to the
  // title's own: it stays put through the crossfade. Offsets, not boxes:
  // the film's focus pull translates the title's text.
  const copy = inner.querySelector<HTMLElement>('.intro-copy');
  const name = inner.querySelector<HTMLElement>('.intro-name');
  const docTop = (el: HTMLElement) => {
    let y = 0;
    for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
    return y;
  };
  const align = () => {
    if (!copy || !name || !title || phase !== 'gate') return;
    copy.style.transform = '';
    const dy = docTop(title) - docTop(name);
    if (Math.abs(dy) >= 1) copy.style.transform = `translateY(${dy}px)`;
  };
  align();
  void document.fonts.ready.then(align);
  window.addEventListener('resize', align);

  const markSeen = () => {
    try {
      opts.storage?.setItem(INTRO_SEEN_KEY, '1');
    } catch {
      // Unstored, it simply shows again next visit.
    }
  };

  // The clip waits for the film's first water, so it never slows that.
  let loading = false;
  const preload = () => {
    if (loading) return;
    loading = true;
    observer.disconnect();
    window.clearTimeout(preloadTimer);
    video.src = window.matchMedia('(orientation: portrait)').matches ? '/intro/tall.mp4' : '/intro/wide.mp4';
    video.preload = 'auto';
    video.load();
  };
  const observer = new MutationObserver(() => {
    if (html.classList.contains('has-dive')) preload();
  });
  const preloadTimer = window.setTimeout(preload, PRELOAD_FALLBACK_MS);
  if (html.classList.contains('has-dive')) preload();
  else observer.observe(html, { attributes: true, attributeFilter: ['class'] });

  // The page stays at the top while the first screen and the clip are up.
  // Captured on window, ahead of the smooth scroller's own listeners.
  const onWheel = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (phase === 'gate') begin(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!SCROLL_KEYS.has(e.key)) return;
    // Space on a focused button or link is that control's, not a scroll.
    if (e.target instanceof Element && e.target.closest('a, button, input, textarea, select')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // A key press does count as a press: the clip may play with sound.
    if (phase === 'gate') begin(true);
  };
  // A dragged scrollbar, which nothing above can stop.
  const onScroll = () => {
    if (window.scrollY <= 0) return;
    window.scrollTo(0, 0);
    if (phase === 'gate') begin(false);
  };
  window.addEventListener('wheel', onWheel, { passive: false, capture: true });
  window.addEventListener('touchmove', onWheel, { passive: false, capture: true });
  window.addEventListener('keydown', onKey, { capture: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  const release = () => {
    window.removeEventListener('wheel', onWheel, { capture: true });
    window.removeEventListener('touchmove', onWheel, { capture: true });
    window.removeEventListener('keydown', onKey, { capture: true });
    window.removeEventListener('scroll', onScroll);
  };

  const syncClipSound = () => {
    video.muted = opts.audio.muted;
  };

  function begin(gesture: boolean) {
    if (phase !== 'gate') return;
    phase = 'clip';
    markSeen();
    preload();
    gate.classList.add('is-playing');
    inner.inert = true;
    skipBtn.focus({ preventScroll: true });
    // The dive's own sound waits under the clip's.
    opts.audio.hold(true);
    if (gesture) void opts.audio.start();
    // Without a press nothing may sound: say so on the toggle (this visit
    // only; the stored choice is untouched), which turns it on.
    else opts.audio.setMuted(true);
    opts.ui.revealSound();
    toggle?.addEventListener('click', syncClipSound);
    syncClipSound();
    video
      .play()
      .catch(() => {
        video.muted = true;
        return video.play();
      })
      .catch(() => handOver());
    startTimer = window.setTimeout(() => {
      if (video.currentTime === 0) handOver();
    }, START_TIMEOUT_MS);
  }

  // The crossfade starts with the clip's last FADE_S seconds.
  const watch = () => {
    if (phase !== 'clip') return;
    if (video.duration && video.duration - video.currentTime <= FADE_S) handOver();
    else requestAnimationFrame(watch);
  };

  function handOver() {
    if (phase === 'out' || phase === 'done') return;
    const played = phase === 'clip';
    phase = 'out';
    window.clearTimeout(startTimer);
    release();
    for (const el of behind) el.inert = false;
    opts.audio.hold(false);
    gate.classList.add('is-leaving');
    // After the clip the descent carries on into About, as Dive in's does;
    // skipped from the first screen, the visitor lands on the title.
    if (played) opts.ui.descend();
    else title?.focus({ preventScroll: true });
    window.setTimeout(finish, FADE_S * 1000 + 100);
  }

  function finish() {
    phase = 'done';
    html.classList.remove('intro');
    window.removeEventListener('resize', align);
    toggle?.removeEventListener('click', syncClipSound);
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  diveBtn.addEventListener('click', () => begin(true));
  skipBtn.addEventListener('click', () => {
    markSeen();
    handOver();
  });
  video.addEventListener('playing', () => requestAnimationFrame(watch));
  video.addEventListener('ended', handOver);
  video.addEventListener('error', () => {
    if (phase === 'clip') handOver();
  });
  // Leaving from the first screen (a menu link) counts as having seen it.
  window.addEventListener('pagehide', () => {
    if (phase === 'gate') markSeen();
  });
}
