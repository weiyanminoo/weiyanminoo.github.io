// The three "outside the work" topics. One copy, because as of Phase 8 two
// pages render them: /outside in full, and Home's own Outside section
// (phase-7-9-brief.md 8.2, "keeps the three interests with their log
// slates"). Not a content collection — there is no markdown body here, just
// three short fields and a list of slate labels, and src/content/ is out of
// scope for this phase. Every string below is moved verbatim from
// outside.astro; nothing here is new copy.

export interface Interest {
  readonly title: string;
  readonly line: string;
  readonly body: string;
  readonly fields: readonly { readonly label: string }[];
}

export const INTERESTS: readonly Interest[] = [
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
    title: 'Keeping active',
    line: 'I will play most sports, enthusiastically and with mixed results.',
    body: 'Training is the constant; the sport rotates.',
    fields: [{ label: 'Sports' }, { label: 'Co-curriculars' }],
  },
];
