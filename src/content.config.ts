import { defineCollection, reference, z } from 'astro:content';
import { glob } from 'astro/loaders';

const roles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/roles' }),
  schema: z.object({
    org: z.string(),
    role: z.string(),
    team: z.string().optional(),
    discipline: z.string(),
    start: z.coerce.date(),
    end: z.coerce.date().nullable().default(null),
    current: z.boolean().default(false),
    summary: z.string(),
    tags: z.array(z.string()).default([]),
  }),
});

// Dates are a free-text `period` string, not coerced Dates as `roles` uses.
// There are two entries and they are ordered by hand, so nothing here needs
// to sort or format a date — and a plain string is what Wei Yan can fill in
// for the second entry without matching a date format.
const school = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/school' }),
  schema: z.object({
    order: z.number().int(),
    institution: z.string(),
    qualification: z.string(),
    period: z.string(),
    summary: z.string(),
    notes: z.array(z.string()).default([]),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    name: z.string(),
    // Kind, summary and link are optional for a project not built yet: it
    // shows its name and dates and claims nothing else.
    kind: z.string().default(''),
    start: z.coerce.date(),
    // The last month worked on; null while ongoing.
    end: z.coerce.date().nullable().default(null),
    ongoing: z.boolean().default(true),
    url: z.string().url().optional(),
    summary: z.string().default(''),
    // Optional: not every project has a measured result worth stating, and
    // an empty one renders nothing rather than a bare "Outcome." label.
    // Write it as `outcome: ''`, never as a bare `-` — an unquoted dash is
    // YAML's block-sequence indicator, not the character, and it fails the
    // build with a confusing indentation error on the FOLLOWING line.
    outcome: z.string().default(''),
    tags: z.array(z.string()).default([]),
  }),
});

// The longer write-ups some projects have, each at /projects/<its project's
// id>, linked from that project's card. The body is the story itself.
const stories = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/stories' }),
  schema: z.object({
    project: reference('projects'),
    title: z.string(),
    // The line under the title, and the page's description.
    dek: z.string(),
  }),
});

export const collections = { roles, school, projects, stories };
