import { z } from 'zod';

/** `GET /api/search?q=` query (spec/api: 2-100 chars). */
export const searchQuerySchema = z.object({
  q: z.string().min(2).max(100),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
