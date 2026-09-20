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

export const collections = { roles, projects };
