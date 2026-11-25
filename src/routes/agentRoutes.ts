import { FastifyPluginAsync } from 'fastify';
import agentController from '../modules/agents/agent.controller';
import knowledgeController from '../modules/knowledge/knowledge.controller';
import skillController from '../modules/skills/skill.controller';
import runtimeController from '../modules/runtime/runtime.controller';
import { requireAuth } from '../middleware/auth';

const agentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  fastify.post(
    '/',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Create a new configurable agent with an initial draft version',
      },
    },
    agentController.create.bind(agentController)
  );

  fastify.get(
    '/',
    {
      schema: {
        tags: ['Agents'],
        summary: 'List agents accessible to the caller in the workspace',
      },
    },
    agentController.list.bind(agentController)
  );

  fastify.get(
    '/:agentId',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Get agent details and versions',
      },
    },
    agentController.getById.bind(agentController)
  );

  fastify.patch(
    '/:agentId',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Update agent metadata or draft configuration',
      },
    },
    agentController.update.bind(agentController)
  );

  fastify.delete(
    '/:agentId',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Archive an agent',
      },
    },
    agentController.archive.bind(agentController)
  );

  fastify.post(
    '/:agentId/duplicate',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Duplicate an agent into a new personal draft',
      },
    },
    agentController.duplicate.bind(agentController)
  );

  fastify.post(
    '/:agentId/validate',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Validate the current draft agent configuration',
      },
    },
    agentController.validate.bind(agentController)
  );

  fastify.post(
    '/:agentId/publish',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Publish the validated draft as an immutable AgentVersion',
      },
    },
    agentController.publish.bind(agentController)
  );

  fastify.post(
    '/:agentId/rollback',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Roll back active agent version to a previously published version',
      },
    },
    agentController.rollback.bind(agentController)
  );

  fastify.post(
    '/:agentId/versions/:versionId/revoke',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Administratively revoke a published agent version',
      },
    },
    agentController.revokeVersion.bind(agentController)
  );

  fastify.get(
    '/:agentId/versions',
    {
      schema: {
        tags: ['Agents'],
        summary: 'List all versions for an agent',
      },
    },
    agentController.listVersions.bind(agentController)
  );

  fastify.get(
    '/:agentId/knowledge-bases',
    { schema: { tags: ['Agents'], summary: 'List knowledge bases attached to an agent' } },
    knowledgeController.listAgentKbs.bind(knowledgeController)
  );

  fastify.post(
    '/:agentId/knowledge-bases',
    { schema: { tags: ['Agents'], summary: 'Attach a knowledge base to an agent' } },
    knowledgeController.attachToAgent.bind(knowledgeController)
  );

  fastify.delete(
    '/:agentId/knowledge-bases/:kbId',
    { schema: { tags: ['Agents'], summary: 'Detach a knowledge base from an agent' } },
    knowledgeController.detachFromAgent.bind(knowledgeController)
  );

  fastify.post(
    '/:agentId/skills',
    { schema: { tags: ['Agents', 'Skills'], summary: 'Attach a skill to an agent draft' } },
    skillController.attachToAgent.bind(skillController)
  );

  fastify.delete(
    '/:agentId/skills/:skillId',
    { schema: { tags: ['Agents', 'Skills'], summary: 'Detach a skill from an agent draft' } },
    skillController.detachFromAgent.bind(skillController)
  );

  fastify.post(
    '/:agentId/execute',
    { schema: { tags: ['Agents', 'Runtime'], summary: 'Execute a configured agent' } },
    runtimeController.execute.bind(runtimeController)
  );

  fastify.get(
    '/:agentId/runs',
    { schema: { tags: ['Agents', 'Observability'], summary: 'List execution runs for an agent' } },
    runtimeController.listConversationRuns.bind(runtimeController)
  );

  fastify.get(
    '/runs/:runId',
    { schema: { tags: ['Observability'], summary: 'Inspect execution events and tool logs for a run' } },
    runtimeController.inspectRun.bind(runtimeController)
  );

  fastify.post(
    '/approvals/:approvalId/resolve',
    { schema: { tags: ['Runtime'], summary: 'Approve or reject a pending HITL approval' } },
    runtimeController.resolveApproval.bind(runtimeController)
  );

  fastify.get(
    '/:agentId/memories',
    { schema: { tags: ['Agents', 'Memory'], summary: 'List cross-thread memories for the calling user and agent' } },
    runtimeController.listMemories.bind(runtimeController)
  );

  fastify.delete(
    '/:agentId/memories',
    { schema: { tags: ['Agents', 'Memory'], summary: 'Clear cross-thread memories for the calling user and agent' } },
    runtimeController.clearMemories.bind(runtimeController)
  );
};

export default agentRoutes;
