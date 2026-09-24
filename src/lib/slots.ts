// How many cards each set is laid out to hold, against however many have
// actually been written. Home and the matching tab both import these, so
// the two pages cannot disagree about how many slots exist.
//
// A page renders its real entries and then fills the shortfall with
// PlaceholderCards. Adding a markdown file therefore removes a placeholder
// on its own — there is no stub entry to delete, and the content schemas
// keep their required fields instead of being loosened to tolerate empty
// ones. Once a set is full, raising the number here is the only change
// needed to open another slot.
export const SCHOOL_SLOTS = 2;
export const PROJECT_SLOTS = 4;
