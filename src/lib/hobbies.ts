// The four "outside the work" pursuits, as Home's Hobbies section names
// them: titles only. They used to carry a line, a paragraph and log-slate
// fields for a /hobbies page of their own; that page went in November 2026
// (there was not enough to say for one), and the lines under Diving and
// Hiking with it.
//
// "Keeping active" was removed at Wei Yan's request when the four below
// were chosen.

export interface Hobby {
  readonly title: string;
}

export const HOBBIES: readonly Hobby[] = [
  { title: 'Diving' },
  { title: 'Hiking' },
  { title: 'Canoeing' },
  { title: 'Crafts' },
];
