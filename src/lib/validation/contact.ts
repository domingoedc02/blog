import { z } from 'zod';

/**
 * `POST /api/contact` body (spec/api). `honeypot` is optional and must be
 * empty when present — a filled honeypot is a bot signal the route maps to
 * `400 BOT_DETECTED`, not a validation failure of this schema itself.
 */
export const contactSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  message: z.string().min(1).max(5000),
  turnstileToken: z.string().min(1),
  honeypot: z.string().optional(),
});

export type ContactInput = z.infer<typeof contactSchema>;
