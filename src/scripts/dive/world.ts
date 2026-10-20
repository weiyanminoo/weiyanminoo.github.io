// The dive site, in world coordinates. One reef, fixed in place; the camera
// swims through it (timeline.ts cameraAt). Metres; y is up, the surface is
// at y = 0 and the dive descends along -y; the swim heads along -z.
//
//   reef top   a coral plateau west of the crest (x < 0), ~19.5 m deep,
//              with spur-and-groove channels running out to the edge
//   crest      the edge, along x = 0, where the reef top rolls over
//   wall       the face, dropping from the crest far below anything the
//              dive reaches; its fans and anthias face east, into the blue
//   the blue   open water east of the wall (x > 0), where the big animals
//              pass
//
// A real wall dive (the descent half of one): back-roll beside the reef,
// free descent in the blue watching the reef rise out of the haze, settle
// over the reef top, fin along it, go over the edge, then drift down the
// face with the wall on the left and the blue on the right.

/** Depth 0 m is just under the surface, not in it: Snell's window is a disc
 *  of radius depth·tan(48.6°), and at under a metre it breaks into blobs
 *  smaller than the ripples. Every world height sits this much lower. */
export const SURFACE_CLEARANCE_M = 3;

/** World y of a depth in metres. */
export const worldY = (depthM: number): number => -(depthM + SURFACE_CLEARANCE_M);

/** The crest line: the reef top is west of it, the blue east. */
export const EDGE_X = 0;
export const REEF_TOP_DEPTH_M = 19.5;
/** Far below anything the camera reaches, so the face never ends in view. */
export const WALL_BOTTOM_DEPTH_M = 95;
/** How far the reef runs along the swim (z), north to south. */
export const REEF_NORTH_Z = 40;
export const REEF_SOUTH_Z = -230;
/** How far the reef top runs west of the crest. */
export const REEF_WEST_X = -70;
