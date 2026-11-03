import { z } from 'zod';

export const createNoteDto = z.object({ title: z.string().trim().min(1).max(200), content: z.string().max(10000) }).strict();
export const updateNoteDto = createNoteDto.partial().refine((value) => Object.keys(value).length > 0, 'Informe um campo');
export const noteParamsDto = z.object({ id: z.uuid() });
export const listNotesDto = z.object({ cursor: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(20) });
export type CreateNote = z.infer<typeof createNoteDto>;
export type UpdateNote = z.infer<typeof updateNoteDto>;
export type ListNotes = z.infer<typeof listNotesDto>;
