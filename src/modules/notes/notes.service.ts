import { AppError } from '../../lib/errors.js';
import type { CreateNote, ListNotes, UpdateNote } from './notes.dto.js';
import type { NotesRepository } from './notes.repository.js';

const requireNote = <T>(note: T | undefined): T => {
  if (!note) throw new AppError(404, 'NOTE_NOT_FOUND', 'Nota não encontrada');
  return note;
};

export class NotesService {
  constructor(private readonly repository: NotesRepository) {}

  async list(ownerId: string, input: ListNotes) {
    const rows = await this.repository.list(ownerId, input);
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
  }

  async find(ownerId: string, id: string) { return requireNote(await this.repository.find(ownerId, id)); }
  create(ownerId: string, input: CreateNote) { return this.repository.create(ownerId, input); }
  async update(ownerId: string, id: string, input: UpdateNote) { return requireNote(await this.repository.update(ownerId, id, input)); }
  async delete(ownerId: string, id: string) { requireNote(await this.repository.delete(ownerId, id)); }
}
