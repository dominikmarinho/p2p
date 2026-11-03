import { and, asc, eq, gt } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { notes } from '../../db/schema.js';
import type { CreateNote, ListNotes, UpdateNote } from './notes.dto.js';

export class NotesRepository {
  constructor(private readonly db: Database) {}

  list(ownerId: string, input: ListNotes) {
    return this.db.select().from(notes).where(and(eq(notes.ownerId, ownerId), input.cursor ? gt(notes.id, input.cursor) : undefined))
      .orderBy(asc(notes.id)).limit(input.limit + 1);
  }

  async find(ownerId: string, id: string) {
    const [note] = await this.db.select().from(notes).where(and(eq(notes.ownerId, ownerId), eq(notes.id, id))).limit(1);
    return note;
  }

  async create(ownerId: string, input: CreateNote) {
    const [note] = await this.db.insert(notes).values({ ownerId, ...input }).returning();
    if (!note) throw new Error('INSERT de nota sem retorno');
    return note;
  }

  async update(ownerId: string, id: string, input: UpdateNote) {
    const [note] = await this.db.update(notes).set({ ...input, updatedAt: new Date() })
      .where(and(eq(notes.ownerId, ownerId), eq(notes.id, id))).returning();
    return note;
  }

  async delete(ownerId: string, id: string) {
    const [note] = await this.db.delete(notes).where(and(eq(notes.ownerId, ownerId), eq(notes.id, id))).returning({ id: notes.id });
    return note;
  }
}
