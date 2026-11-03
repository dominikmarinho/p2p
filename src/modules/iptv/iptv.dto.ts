import { z } from 'zod';

export const lineCredentialsDto = z.object({ username: z.string().min(1).max(128), password: z.string().min(1).max(256) }).strict();
export const contentKindDto = z.enum(['live', 'movie', 'series']);
export type ContentKind = z.infer<typeof contentKindDto>;
export interface CatalogItem { id: string; name: string; categoryId: string; image: string; kind: ContentKind; extension: string }
export const accountDto = z.object({ user_info: z.object({ auth: z.union([z.number(), z.string()]), username: z.string().optional(), status: z.string().optional(), exp_date: z.union([z.string(), z.number(), z.null()]).optional(), max_connections: z.union([z.string(), z.number()]).optional() }) });
export const sessionDto = z.object({ username: z.string(), password: z.string(), accountId: z.string(), expiresAt: z.number(), maxConnections: z.number(), validatedAt: z.number().default(0) });
export type ClientSession = z.infer<typeof sessionDto>;
export const mediaGrantDto = z.object({ relay: z.boolean().default(false), sessionHash: z.string(), kind: z.enum(['live', 'movie', 'episode']), id: z.string().regex(/^\d+$/), extension: z.string(), swarmId: z.string(), expiresAt: z.number() });
export type MediaGrant = z.infer<typeof mediaGrantDto>;
