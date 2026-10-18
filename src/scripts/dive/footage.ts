// The point-of-view inserts' <video> elements (spec §8). Nothing is
// fetched until the dive passes 12 m (preload), only the clip on screen
// plays, and everything pauses while the tab is hidden. Videos are muted
// and inline, so autoplay policy allows them; when a browser still refuses
// (iOS Low Power Mode, a slow or failed fetch) the clip simply never
// becomes ready and the insert layer shows its poster still instead.
//
// In review mode playback never runs: seekTo puts a clip on an exact frame
// so a seeked render is deterministic.

import type { ClipId } from './types';

export interface Footage {
  /** Review mode: clips are positioned by seekTo, never played. */
  readonly exact: boolean;
  video(clip: ClipId): HTMLVideoElement;
  poster(clip: ClipId): HTMLImageElement;
  /** True once the clip has a frame to show and (outside review) is playing. */
  ready(clip: ClipId): boolean;
  /** Loop length in seconds (built by scripts/footage). */
  duration(clip: ClipId): number;
  preload(): void;
  setActive(clip: ClipId | null): void;
  seekTo(clip: ClipId, t: number): Promise<void>;
  dispose(): void;
}

// The loops built by scripts/footage/clips.mjs: source duration − 1.
const LOOP_S: Record<ClipId, number> = { wall: 6, slope: 4 };
const CLIPS: readonly ClipId[] = ['wall', 'slope'];
const SEEK_TIMEOUT_MS = 5000;

export function createFootage(
  base: string,
  quality: '1080' | '720' | '540',
  opts: { review: boolean },
): Footage {
  // No camera originals yet, so the 1080 tier is served the 720 files.
  const rendition = quality === '1080' ? '720' : quality;
  const videos = new Map<ClipId, HTMLVideoElement>();
  const posters = new Map<ClipId, HTMLImageElement>();
  const playing = new Set<ClipId>();
  let active: ClipId | null = null;
  let preloaded = false;

  for (const clip of CLIPS) {
    const v = document.createElement('video');
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.loop = true;
    v.preload = 'none';
    v.setAttribute('aria-hidden', 'true');
    // In the document (but invisible) rather than detached: some mobile
    // browsers only decode inline video that is attached.
    v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0';
    v.addEventListener('playing', () => playing.add(clip));
    v.addEventListener('pause', () => playing.delete(clip));
    v.addEventListener('error', () => playing.delete(clip));
    document.body.appendChild(v);
    videos.set(clip, v);
    posters.set(clip, new Image());
  }

  const play = (clip: ClipId) => {
    if (opts.review || document.hidden) return;
    videos.get(clip)!.play().catch(() => {
      // Refused (autoplay policy, power saving) or failed: stay on the poster.
    });
  };

  const onVisibility = () => {
    for (const [clip, v] of videos) {
      if (document.hidden || clip !== active) v.pause();
      else play(clip);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  const preload = () => {
    if (preloaded) return;
    preloaded = true;
    for (const clip of CLIPS) {
      posters.get(clip)!.src = `${base}/${clip}-poster.jpg`;
      const v = videos.get(clip)!;
      v.preload = 'auto';
      v.src = `${base}/${clip}-${rendition}.mp4`;
    }
  };

  return {
    exact: opts.review,
    video: (clip) => videos.get(clip)!,
    poster: (clip) => posters.get(clip)!,
    duration: (clip) => LOOP_S[clip],
    ready(clip) {
      const v = videos.get(clip)!;
      return v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && (opts.review || playing.has(clip));
    },
    preload,
    setActive(clip) {
      if (clip === active) return;
      active = clip;
      if (clip) preload();
      for (const [c, v] of videos) {
        if (c === clip) play(c);
        else v.pause();
      }
    },
    seekTo(clip, t) {
      preload();
      const v = videos.get(clip)!;
      return new Promise<void>((resolve) => {
        const timer = window.setTimeout(done, SEEK_TIMEOUT_MS);
        function done() {
          window.clearTimeout(timer);
          v.removeEventListener('seeked', done);
          v.removeEventListener('loadeddata', seek);
          resolve();
        }
        function seek() {
          v.addEventListener('seeked', done, { once: true });
          v.currentTime = t;
        }
        if (v.readyState >= HTMLMediaElement.HAVE_METADATA) seek();
        else v.addEventListener('loadeddata', seek, { once: true });
      });
    },
    dispose() {
      document.removeEventListener('visibilitychange', onVisibility);
      for (const v of videos.values()) {
        v.pause();
        v.removeAttribute('src');
        v.load();
        v.remove();
      }
    },
  };
}
