import type { CreateNote, ListNotes, UpdateNote } from './notes.dto.js';
import type { NotesService } from './notes.service.js';

export class NotesController {
  constructor(private readonly service: NotesService) {}
  list = (ownerId: string, input: ListNotes) => this.service.list(ownerId, input);
  find = (ownerId: string, id: string) => this.service.find(ownerId, id);
  create = (ownerId: string, input: CreateNote) => this.service.create(ownerId, input);
  update = (ownerId: string, id: string, input: UpdateNote) => this.service.update(ownerId, id, input);
  delete = (ownerId: string, id: string) => this.service.delete(ownerId, id);
}
