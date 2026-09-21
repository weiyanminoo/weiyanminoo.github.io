// The contract every effect module draws against. `paint()` in canvas.ts
// builds one WaterFrame per frame (after painting the base gradient) and
// calls each Effect in order. An effect owns its own intensity — it reads
// depthTop/depthBottom and draws nothing when there is nothing to show.

export interface WaterFrame {
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number; // CSS pixels, not device pixels
  readonly height: number; // CSS pixels
  readonly time: number; // seconds since mount, monotonic
  readonly depthTop: number; // metres at the top of the viewport
  readonly depthBottom: number; // metres at the bottom of the viewport
}

export type Effect = (frame: WaterFrame) => void;
