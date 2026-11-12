import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { z } from 'astro/zod';

/** Two to four primary sources, rendered in the lesson footer. */
const furtherReading = z
  .array(z.object({ title: z.string().min(1), url: z.url(), note: z.string().optional() }))
  .min(1)
  .max(4)
  .optional();

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({ extend: z.object({ furtherReading }) }),
  }),
};
