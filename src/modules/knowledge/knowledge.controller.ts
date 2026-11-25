import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getWorkspaceContext } from '../../middleware/auth';
import knowledgeBaseService from './knowledge-base.service';

const createKbSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  retrievalDefaults: z
    .object({
      topK: z.number().int().min(1).max(20).optional(),
      scoreThreshold: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

const ingestTextSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().min(1),
  uri: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

const testRetrievalSchema = z.object({
  query: z.string().min(1).max(500),
  topK: z.number().int().min(1).max(20).optional(),
  scoreThreshold: z.number().min(0).max(1).optional(),
  metadataFilters: z.record(z.string(), z.any()).optional(),
});

const attachKbSchema = z.object({
  knowledgeBaseId: z.string().uuid(),
  retrievalConfig: z.record(z.string(), z.any()).optional(),
  isEnabled: z.boolean().optional(),
});

export class KnowledgeController {
  async create(req: FastifyRequest, reply: FastifyReply) {
    const body = createKbSchema.parse(req.body);
    const ctx = getWorkspaceContext(req);
    const kb = await knowledgeBaseService.createKnowledgeBase(ctx, body);
    return reply.status(201).send({ success: true, data: kb });
  }

  async list(req: FastifyRequest, reply: FastifyReply) {
    const ctx = getWorkspaceContext(req);
    const kbs = await knowledgeBaseService.listKnowledgeBases(ctx);
    return reply.status(200).send({ success: true, data: kbs });
  }

  async getById(req: FastifyRequest<{ Params: { kbId: string } }>, reply: FastifyReply) {
    const ctx = getWorkspaceContext(req);
    const kb = await knowledgeBaseService.getKnowledgeBaseById(ctx, req.params.kbId);
    return reply.status(200).send({ success: true, data: kb });
  }

  async ingestText(req: FastifyRequest<{ Params: { kbId: string } }>, reply: FastifyReply) {
    const body = ingestTextSchema.parse(req.body);
    const ctx = getWorkspaceContext(req);
    const doc = await knowledgeBaseService.ingestTextDocument(ctx, req.params.kbId, body);
    return reply.status(201).send({ success: true, data: doc });
  }

  async testRetrieval(req: FastifyRequest<{ Params: { kbId: string } }>, reply: FastifyReply) {
    const body = testRetrievalSchema.parse(req.body);
    const ctx = getWorkspaceContext(req);
    const result = await knowledgeBaseService.testRetrieval(ctx, req.params.kbId, body);
    return reply.status(200).send({ success: true, data: result });
  }

  async attachToAgent(req: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) {
    const body = attachKbSchema.parse(req.body);
    const ctx = getWorkspaceContext(req);
    const link = await knowledgeBaseService.attachToAgent(ctx, req.params.agentId, body);
    return reply.status(201).send({ success: true, data: link });
  }

  async detachFromAgent(
    req: FastifyRequest<{ Params: { agentId: string; kbId: string } }>,
    reply: FastifyReply
  ) {
    const ctx = getWorkspaceContext(req);
    await knowledgeBaseService.detachFromAgent(ctx, req.params.agentId, req.params.kbId);
    return reply.status(200).send({ success: true, message: 'Knowledge base detached' });
  }

  async listAgentKbs(req: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) {
    const ctx = getWorkspaceContext(req);
    const links = await knowledgeBaseService.listAgentKnowledgeBases(ctx, req.params.agentId);
    return reply.status(200).send({ success: true, data: links });
  }
}

export const knowledgeController = new KnowledgeController();
export default knowledgeController;
