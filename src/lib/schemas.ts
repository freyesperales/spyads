import { z } from "zod";

export const createScanSchema = z.object({
  brand: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200),
  company: z.string().trim().max(200).optional().or(z.literal("")),
  countries: z
    .array(z.string().regex(/^[A-Z]{2}$/, "2-letter ISO code"))
    .max(20)
    .optional()
    .default([]),
  utmSource: z.string().max(80).optional(),
  utmMedium: z.string().max(80).optional(),
  utmCampaign: z.string().max(80).optional(),
});

export type CreateScanInput = z.infer<typeof createScanSchema>;
