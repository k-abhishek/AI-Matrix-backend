import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getWorkspaceContext } from '../../middleware/auth';
import skillService from './skill.service';

const createSkillSchema = z.object({
  key: z.string().min(1).max(80).regex(/^[a-z0-9_-]+$/i, 'key must be alphanumeric/dash/underscore'),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  scope: z.enum(['PLATFORM', 'WORKSPACE', 'PERSONAL']).optional(),
  category: z.enum(['INSTRUCTION', 'TOOL', 'WORKFLOW']).optional(),
  summary: z.string().min(1).max(500),
  instructions: z.string().min(1),
  inputSchema: z.record(z.string(), z.any()).optional(),
  requiredCapabilities: z.array(z.string()).optional(),
  permittedToolKeys: z.array(z.string()).optional(),
  workflowDefinition: z.record(z.string(), z.any()).optional(),
  settingsSchema: z.record(z.string(), z.any()).optional(),
});

const updateSkillSchema = createSkillSchema.omit({ key: true, scope: true, category: true }).partial();

const testSkillSchema = z.object({
  prompt: z.string().min(1),
});

const attachSkillSchema = z.object({
  skillId: z.string().uuid(),
  priority: z.number().int().optional(),
  settingsOverride: z.record(z.string(), z.any()).optional(),
});

export class SkillController {
  async create(req: FastifyRequest, reply: FastifyReply) {
    const body = createSkillSchema.parse(req.body);
    const ctx = getWorkspaceContext(req);
    const result = await skillService.createSkill(ctx, body);
    return reply.status(201).send({ success: true, data: result });
  }

  async list(
    req: FastifyRequest<{ Querystring: { scope?: 'PLATFORM' | 'WORKSPACE' | 'PERSONAL'; category?: 'INSTRUCTION' | 'TOOL' | 'WORKFLOW' } }>,
    reply: FastifyReply
  ) {
    const ctx = getWorkspaceContext(req);
    const skills = await skillService.listSkills(ctx, req.query || {});
    return reply.status(200).send({ success: true, data: skills });
  }

  async getById(req: FastifyRequest<{ Params: { skillId: string } }>, reply: FastifyReply) {
    const ctx = getWorkspaceContext(req);
    const skill = await skillService.getSkillById(ctx, req.params.skillId);
    return reply.status(200).send({ success: true, data: skill });
  }

  async update(req: FastifyRequest<{ Params: { skillId: string } }>, reply: FastifyReply) {
    const body = updateSkillSchema.parse(req.body);
    const ctx = getWorkspaceContext(req);
    const result = await skillService.updateSkill(ctx, req.params.skillId, body);
    return reply.status(200).send({ success: true, data: result });
  }

  async validate(req: FastifyRequest<{ Params: { skillId: string } }>, reply: FastifyReply) {
    const ctx = getWorkspaceContext(req);
    const result = await skillService.validateSkill(ctx, req.params.skillId);
    return reply.status(200).send({ success: true, data: result });
  }

  async publish(req: FastifyRequest<{ Params: { skillId: string } }>, reply: FastifyReply) {
    const ctx = getWorkspaceContext(req);
    const result = await skillService.publishSkill(ctx, req.params.skillId);
    return reply.status(200).send({ success: true, data: result });
  }

  async test(req: FastifyRequest<{ Params: { skillId: string } }>, reply: FastifyReply) {
    const body = testSkillSchema.parse(req.body);
    const ctx = getWorkspaceContext(req);
    const result = await skillService.testSkill(ctx, req.params.skillId, body.prompt);
    return reply.status(200).send({ success: true, data: result });
  }

  async attachToAgent(req: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) {
    const body = attachSkillSchema.parse(req.body);
    const ctx = getWorkspaceContext(req);
    const result = await skillService.attachToAgent(ctx, req.params.agentId, body.skillId, body);
    return reply.status(201).send({ success: true, data: result });
  }

  async detachFromAgent(
    req: FastifyRequest<{ Params: { agentId: string; skillId: string } }>,
    reply: FastifyReply
  ) {
    const ctx = getWorkspaceContext(req);
    const result = await skillService.detachFromAgent(ctx, req.params.agentId, req.params.skillId);
    return reply.status(200).send({ success: true, data: result });
  }
}

export const skillController = new SkillController();
export default skillController;
