import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { NotesController } from './notes.controller.js';
import { createNoteDto, listNotesDto, noteParamsDto, updateNoteDto } from './notes.dto.js';

export function notesRoutes(app: FastifyInstance, controller: NotesController): void {
  const router = app.withTypeProvider<ZodTypeProvider>();
  router.addHook('onRequest', app.authenticate);
  router.get('/', { schema: { querystring: listNotesDto } }, async (request) => controller.list(request.user.sub, request.query));
  router.get('/:id', { schema: { params: noteParamsDto } }, async (request) => controller.find(request.user.sub, request.params.id));
  router.post('/', { schema: { body: createNoteDto } }, async (request, reply) =>
    reply.code(201).send(await controller.create(request.user.sub, request.body)));
  router.patch('/:id', { schema: { params: noteParamsDto, body: updateNoteDto } }, async (request) =>
    controller.update(request.user.sub, request.params.id, request.body));
  router.delete('/:id', { schema: { params: noteParamsDto } }, async (request, reply) => {
    await controller.delete(request.user.sub, request.params.id);
    return reply.code(204).send();
  });
}
