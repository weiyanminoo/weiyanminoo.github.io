// Shared shapes for the dive. Pure data only — nothing here imports Three.js,
// so the timeline, optics and path modules stay testable in plain Node.

/** sRGB, each channel 0..1. */
export type RGB = readonly [r: number, g: number, b: number];

/** Metres. y is up; the camera sits at y = -depth. */
export type Vec3 = readonly [x: number, y: number, z: number];

export type SectionId = 'title' | 'about' | 'work' | 'school' | 'projects' | 'hobbies' | 'contact';

export type ShotId =
  | 'surface'
  | 'descent'
  | 'school'
  | 'wall'
  | 'insert-wall'
  | 'insert-slope'
  | 'reef-top'
  | 'manta'
  | 'shark'
  | 'thermocline'
  | 'dropoff'
  | 'deep';

export type ClipId = 'wall' | 'slope';

/** Radians. Positive pitch looks up. */
export interface CameraPose {
  pitch: number;
  yaw: number;
}

/** Scroll-driven moments, each 0..1. */
export interface DiveEvents {
  exhaleBurst: number;
  snapperCross: number;
  manta: number;
  shark: number;
  thermocline: number;
}

export interface DiveState {
  progress: number;
  depth: number;
  shot: ShotId;
  /** 0..1 through the current shot. */
  shotT: number;
  camera: CameraPose;
  insert: { clip: ClipId; pushIn: number } | null;
  events: DiveEvents;
}

export interface WaterSample {
  /** The colour distant things fade into. */
  fog: RGB;
  /** Per metre, for exponential-squared fog. */
  fogDensity: number;
  /** Share of each channel's surface light that survives to this depth. */
  transmittance: RGB;
  shafts: number;
  caustics: number;
  ambient: number;
}

export interface DiveFrame {
  state: DiveState;
  water: WaterSample;
  timeS: number;
  /** 0..1 progress of the Dive-in burst; 1 when finished or never started. */
  entry: number;
}
