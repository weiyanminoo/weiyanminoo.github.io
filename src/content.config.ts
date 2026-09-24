import { defineCollection, z } from 'astro:content';
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
    depth: z.number().int().positive(),
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
    kind: z.string(),
    start: z.coerce.date(),
    ongoing: z.boolean().default(true),
    url: z.string().url(),
    summary: z.string(),
    outcome: z.string(),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { roles, school, projects };
