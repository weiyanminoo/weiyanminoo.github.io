// The dive's sound (spec §7), as a Web Audio graph that starts only on the
// Dive-in gesture:
//
//   bed        ~20 s of clip 4's own housing-and-water ambience, looped,
//              low-passed and quietened with depth (audioMath.depthFilter)
//   breathing  synthesized regulator breaths on the shared breath clock
//              (breath.ts), so the exhale bubbles on screen and the exhale
//              you hear coincide; closer during the point-of-view inserts
//   cues       a splash on entry, a low swell for the manta and another at
//              the thermocline
//
// The same graph builder runs in an OfflineAudioContext (renderPreview) so
// the mix's loudness can be measured.

import { depthFilter } from './audioMath';
import { breathAt } from './breath';
import { hash1 } from './noise';
import type { DiveFrame } from './types';

export type Cue = 'splash' | 'manta' | 'thermocline';

export interface DiveAudio {
  start(): Promise<void>;
  setDepth(m: number): void;
  setInsert(active: boolean): void;
  cue(name: Cue): void;
  setMuted(m: boolean): void;
  readonly muted: boolean;
  readonly context: AudioContext | null;
  dispose(): void;
}

// Mix. MASTER is set from a measured offline render (see renderPreview and
// scripts/dive-review --loudness): about −16 LUFS integrated at 20 m,
// quieter than video, because this is ambience under reading. Measured
// through the limiter: 0.8 → −30.7 LUFS, 4.3 → −14.1, so 3.4.
const MASTER = 3.4;
const BED_LEVEL = 0.5;
const BREATH_LEVEL = 0.5;
// +3 dB: the breath comes close during the inserts.
const INSERT_BOOST = 1.41;
const LOOKAHEAD_S = 2;
const SCHEDULE_EVERY_MS = 250;
const SCAN_STEP_S = 0.02;
// Longer than any envelope (the exhale runs 2.2 s), so every burst can start
// at its own seeded offset into it.
const NOISE_S = 4;
const SEED = 909;
const RAMP_S = 0.3;

interface Graph {
  master: GainNode;
  bedFilter: BiquadFilterNode;
  bedGain: GainNode;
  breathGain: GainNode;
  noise: AudioBuffer;
}

function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_S), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = hash1(i, SEED) * 2 - 1;
  return buffer;
}

function buildGraph(ctx: BaseAudioContext, bed: AudioBuffer | null): Graph {
  const master = ctx.createGain();
  // A limiter after the master: the mix is brought up to its loudness
  // target, and breath bursts must not clip on the way.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  master.connect(limiter).connect(ctx.destination);
  const bedFilter = ctx.createBiquadFilter();
  bedFilter.type = 'lowpass';
  const bedGain = ctx.createGain();
  bedFilter.connect(bedGain).connect(master);
  const breathGain = ctx.createGain();
  breathGain.gain.value = BREATH_LEVEL;
  breathGain.connect(master);
  if (bed) {
    const src = ctx.createBufferSource();
    src.buffer = bed;
    src.loop = true;
    src.connect(bedFilter);
    src.start();
  }
  return { master, bedFilter, bedGain, breathGain, noise: makeNoise(ctx) };
}

/** Filtered noise through an envelope of [time offset, level] points. */
function noiseBurst(
  ctx: BaseAudioContext,
  g: Graph,
  out: AudioNode,
  at: number,
  type: BiquadFilterType,
  hz: number,
  q: number,
  env: readonly (readonly [number, number])[],
) {
  const src = ctx.createBufferSource();
  src.buffer = g.noise;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = hz;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  for (const [dt, level] of env) gain.gain.linearRampToValueAtTime(level, at + dt);
  src.connect(filter).connect(gain).connect(out);
  const length = env[env.length - 1][0];
  src.start(at, hash1(Math.floor(at * 10), SEED + 1) * (NOISE_S - length - 0.1));
  src.stop(at + length + 0.05);
}

function tone(ctx: BaseAudioContext, out: AudioNode, at: number, from: number, to: number, dur: number, level: number) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(level, at + dur * 0.25);
  gain.gain.linearRampToValueAtTime(0, at + dur);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function inhale(ctx: BaseAudioContext, g: Graph, at: number) {
  // Regulator hiss.
  noiseBurst(ctx, g, g.breathGain, at, 'bandpass', 2500, 2, [
    [0.35, 0.22],
    [1.0, 0.15],
    [1.4, 0],
  ]);
}

function exhale(ctx: BaseAudioContext, g: Graph, at: number, cycle: number) {
  // The low rush of the exhaust, then bubbles chirping as they leave.
  noiseBurst(ctx, g, g.breathGain, at, 'lowpass', 300, 0.7, [
    [0.15, 0.35],
    [1.2, 0.25],
    [2.2, 0],
  ]);
  const chirps = 6 + Math.floor(hash1(cycle, SEED + 2) * 5);
  for (let i = 0; i < chirps; i++) {
    const t = at + 0.2 + hash1(cycle * 31 + i, SEED + 3) * 1.8;
    tone(ctx, g.breathGain, t, 400, 900, 0.06 + 0.06 * hash1(cycle * 31 + i, SEED + 4), 0.06);
  }
}

function playCue(ctx: BaseAudioContext, g: Graph, name: Cue, at: number) {
  if (name === 'splash') {
    noiseBurst(ctx, g, g.master, at, 'highpass', 900, 0.7, [
      [0.02, 0.5],
      [0.9, 0],
    ]);
    tone(ctx, g.master, at, 70, 45, 0.4, 0.4);
  } else if (name === 'manta') {
    for (const hz of [55, 82]) tone(ctx, g.master, at, hz, hz * 0.97, 3.5, 0.12);
  } else {
    noiseBurst(ctx, g, g.master, at, 'bandpass', 180, 0.8, [
      [1.2, 0.2],
      [2.6, 0],
    ]);
  }
}

/** Schedules every breath event whose dive-clock time falls in [from, to),
 *  mapped to context time by subtracting `offset`. */
function scheduleBreaths(ctx: BaseAudioContext, g: Graph, from: number, to: number, offset: number) {
  let prev = breathAt(from);
  for (let t = from + SCAN_STEP_S; t < to; t += SCAN_STEP_S) {
    const b = breathAt(t);
    const at = Math.max(ctx.currentTime, t - offset);
    if (b.cycle !== prev.cycle) inhale(ctx, g, at);
    else if (prev.phase < 0.4 && b.phase >= 0.4) exhale(ctx, g, at, b.cycle);
    prev = b;
  }
}

async function loadBed(ctx: BaseAudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url);
    return await ctx.decodeAudioData(await res.arrayBuffer());
  } catch {
    // No bed is still a dive: breathing and cues carry on.
    return null;
  }
}

/** An offline render of the mix at one depth, for measuring loudness. */
export async function renderPreview(bedUrl: string, seconds: number, depthM: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.floor(seconds * 48000), 48000);
  const g = buildGraph(ctx, await loadBed(ctx, bedUrl));
  const f = depthFilter(depthM);
  g.bedFilter.frequency.value = f.lowpassHz;
  g.bedGain.gain.value = BED_LEVEL * f.gain;
  g.master.gain.value = MASTER;
  scheduleBreaths(ctx, g, 0, seconds, 0);
  return ctx.startRendering();
}

export function createAudio(opts: { bed: string; clock(): number; muted: boolean }): DiveAudio {
  let ctx: AudioContext | null = null;
  let g: Graph | null = null;
  let muted = opts.muted;
  let offset = 0;
  let scheduledUntil = 0;
  let timer = 0;
  let lastHz = -1;
  let lastGain = -1;
  let insert = false;

  const schedule = () => {
    if (!ctx || !g || ctx.state !== 'running') return;
    const to = ctx.currentTime + LOOKAHEAD_S + offset;
    const from = Math.max(scheduledUntil, ctx.currentTime + offset);
    if (to > from) scheduleBreaths(ctx, g, from, to, offset);
    scheduledUntil = to;
  };

  // Review Focus 5: back from the background, wake the context. A refusal
  // just leaves it suspended until the visitor's next tap.
  const onVisibility = () => {
    if (document.hidden || !ctx) return;
    ctx.resume().then(
      () => {
        if (ctx) offset = opts.clock() - ctx.currentTime;
        scheduledUntil = 0;
      },
      () => {},
    );
  };

  return {
    async start() {
      try {
        if (!ctx) {
          ctx = new AudioContext();
          g = buildGraph(ctx, null);
          g.master.gain.value = muted ? 0 : MASTER;
          const context = ctx;
          void loadBed(context, opts.bed).then((bed) => {
            if (!bed || !g || ctx !== context) return;
            const src = context.createBufferSource();
            src.buffer = bed;
            src.loop = true;
            src.connect(g.bedFilter);
            src.start();
          });
          document.addEventListener('visibilitychange', onVisibility);
          timer = window.setInterval(schedule, SCHEDULE_EVERY_MS);
        }
        await ctx.resume();
        offset = opts.clock() - ctx.currentTime;
        scheduledUntil = 0;
        schedule();
      } catch {
        // No Web Audio, or it refused to start: the dive goes on silently.
      }
    },
    setDepth(m) {
      if (!ctx || !g) return;
      const f = depthFilter(m);
      const gain = BED_LEVEL * f.gain;
      if (Math.abs(f.lowpassHz - lastHz) / Math.max(1, lastHz) > 0.01 || Math.abs(gain - lastGain) > 0.005) {
        lastHz = f.lowpassHz;
        lastGain = gain;
        g.bedFilter.frequency.setTargetAtTime(f.lowpassHz, ctx.currentTime, RAMP_S);
        g.bedGain.gain.setTargetAtTime(gain, ctx.currentTime, RAMP_S);
      }
    },
    setInsert(active) {
      if (!ctx || !g || active === insert) return;
      insert = active;
      g.breathGain.gain.setTargetAtTime(BREATH_LEVEL * (active ? INSERT_BOOST : 1), ctx.currentTime, RAMP_S);
    },
    cue(name) {
      if (ctx && g && ctx.state === 'running') playCue(ctx, g, name, ctx.currentTime + 0.02);
    },
    setMuted(m) {
      muted = m;
      if (ctx && g) g.master.gain.setTargetAtTime(m ? 0 : MASTER, ctx.currentTime, 0.05);
    },
    get muted() {
      return muted;
    },
    get context() {
      return ctx;
    },
    dispose() {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      void ctx?.close().catch(() => {});
      ctx = null;
      g = null;
    },
  };
}

/** Per-frame bridge from the film to the sound: depth, inserts, and the
 *  cues edge-triggered by the storyboard's events. */
export function frameSync(audio: DiveAudio): (frame: DiveFrame) => void {
  let prevManta = 0;
  let prevThermo = 0;
  return (frame) => {
    const { depth, insert, events } = frame.state;
    audio.setDepth(depth);
    audio.setInsert(insert !== null);
    if (prevManta < 0.1 && events.manta >= 0.1) audio.cue('manta');
    if (prevThermo < 0.5 && events.thermocline >= 0.5) audio.cue('thermocline');
    prevManta = events.manta;
    prevThermo = events.thermocline;
  };
}
