// The two point-of-view inserts cut from Wei Yan's own clips (spec §3, §8),
// and the ambience bed. Start times were checked against 1 fps contact
// sheets: a steady stretch with fish and no other diver in frame.

// Durations were cut from the spec's ~10 s and ~8 s to fit the footage
// budgets (spec §8: "the clips get shorter before the quality drops").
export const CLIPS = [
  // Clip 4: the reef wall with clouds of anthias and sergeant majors.
  { id: 'wall', file: 'video_2026-10-18_18-41-07.mp4', start: 16, duration: 7, stabilise: false },
  // Clip 3: swimming forward along the slope, moorish idols; the shakiest
  // clip, so it is stabilised.
  { id: 'slope', file: 'video_2026-10-18_18-41-02.mp4', start: 14, duration: 5, stabilise: true },
];

// 20 s of clip 4's own housing-and-water ambience, from 10 s in.
export const BED = { file: 'video_2026-10-18_18-41-07.mp4', start: 10, duration: 20 };

// Encodes per tier (quality.ts TierSettings.footage). 1080 only exists once
// camera originals are supplied; until then the 720 files serve it.
// CRFs chosen to land inside the 4 MB / 2 MB budgets after the clips were
// shortened; the wall clip's swarm of anthias is what costs the bits.
export const RENDITIONS = [
  { name: '720', height: 720, crf: 30 },
  { name: '540', height: 540, crf: 32 },
];

// Sensor noise and drifting particulate are what make underwater footage
// expensive to encode. Strip them here; post.ts lays the same film grain
// over CG and footage alike, so nothing is lost on screen.
export const DENOISE = 'hqdn3d=4:3:6:4.5';

// Film rate: plenty for drifting reef life, and it buys clip length within
// the budget.
export const FPS = 24;

// Teal → blue (spec §2: footage hue ≈170° graded towards the reference's
// ≈205°): cut green, lift blue. Verified by verify.mjs (190–220°).
export const GRADE = 'colorchannelmixer=rr=1.0:gg=0.78:gb=0.0:bb=1.1,eq=gamma=1.04';
