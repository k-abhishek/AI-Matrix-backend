import { FastifyReply, FastifyRequest } from 'fastify';
import agentBindingService from './agent-binding.service';
import { getWorkspaceContext } from '../../middleware/auth';

export class AgentBindingController {
  private getWorkspaceId(req: FastifyRequest): string {
    return getWorkspaceContext(req).workspaceId;
  }

  async list(req: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) {
    const { agentId } = req.params;
    const workspaceId = this.getWorkspaceId(req);
    const bindings = await agentBindingService.listBindings(agentId, workspaceId);
    return reply.status(200).send({
      success: true,
      data: bindings,
    });
  }

  async create(
    req: FastifyRequest<{
      Params: { agentId: string };
      Body: { connectionId: string; allowedToolNames?: string[]; isEnabled?: boolean };
    }>,
    reply: FastifyReply
  ) {
    const { agentId } = req.params;
    const workspaceId = this.getWorkspaceId(req);
    const binding = await agentBindingService.createBinding(agentId, workspaceId, req.body);
    return reply.status(201).send({
      success: true,
      data: binding,
    });
  }

  async update(
    req: FastifyRequest<{
      Params: { agentId: string; connectionId: string };
      Body: { allowedToolNames?: string[]; isEnabled?: boolean };
    }>,
    reply: FastifyReply
  ) {
    const { agentId, connectionId } = req.params;
    const workspaceId = this.getWorkspaceId(req);
    const binding = await agentBindingService.updateBinding(agentId, connectionId, workspaceId, req.body);
    return reply.status(200).send({
      success: true,
      data: binding,
    });
  }

  async delete(
    req: FastifyRequest<{ Params: { agentId: string; connectionId: string } }>,
    reply: FastifyReply
  ) {
    const { agentId, connectionId } = req.params;
    const workspaceId = this.getWorkspaceId(req);
    await agentBindingService.deleteBinding(agentId, connectionId, workspaceId);
    return reply.status(200).send({
      success: true,
      message: 'Agent connector binding removed successfully',
    });
  }
}

export const agentBindingController = new AgentBindingController();
export default agentBindingController;
