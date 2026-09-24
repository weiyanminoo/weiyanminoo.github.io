// The four "outside the work" topics. One copy, because two pages render
// them: /hobbies in full, and Home's own Hobbies section as title-and-line
// cards only.
//
// Diving and hiking carry the copy they have always had. Canoeing and
// crafts are yours to write — `line` is the short line under the title on
// both pages, `body` is the extra paragraph /hobbies adds, and `fields` are
// the log-slate rows on /hobbies. An empty string or an empty array renders
// nothing at all rather than a placeholder, so a topic you have not written
// yet shows as a bare title and never claims anything on your behalf.
//
// "Keeping active" was removed at Wei Yan's request when the four hobbies
// below were chosen. Its slate carried the only Sports and Co-curriculars
// fields on the site; neither has a home now.

export interface Hobby {
  readonly title: string;
  readonly line: string;
  readonly body: string;
  readonly fields: readonly { readonly label: string }[];
}

export const HOBBIES: readonly Hobby[] = [
  {
    title: 'Diving',
    line: 'The reason this site descends as you read it.',
    body: 'Slow, quiet, and entirely about paying attention to what is actually in front of you.',
    fields: [{ label: 'Certification' }, { label: 'Logged dives' }, { label: 'Best site so far' }],
  },
  {
    title: 'Hiking',
    line: 'The other direction, and the opposite pace.',
    body: 'Long routes, early starts, and a real weakness for a good ridge line.',
    fields: [{ label: 'Favourite route' }, { label: 'Next on the list' }],
  },
  {
    title: 'Canoeing',
    line: '',
    body: '',
    fields: [],
  },
  {
    title: 'Crafts',
    line: '',
    body: '',
    fields: [],
  },
];
