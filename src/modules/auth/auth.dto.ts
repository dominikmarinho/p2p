import { z } from 'zod';

export const credentialsDto = z.object({
  email: z.email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(12).max(128),
}).strict();
export const refreshDto = z.object({ refreshToken: z.string().regex(/^[a-f0-9]{96}$/) }).strict();
export const tokenPairDto = z.object({
  accessToken: z.string(), refreshToken: z.string(), tokenType: z.literal('Bearer'), expiresIn: z.number(),
});
export type Credentials = z.infer<typeof credentialsDto>;
