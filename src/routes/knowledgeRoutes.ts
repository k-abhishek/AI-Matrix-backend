import { FastifyPluginAsync } from 'fastify';
import knowledgeController from '../modules/knowledge/knowledge.controller';
import { requireAuth } from '../middleware/auth';

const knowledgeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  fastify.post(
    '/',
    { schema: { tags: ['Knowledge Bases'], summary: 'Create a workspace knowledge base' } },
    knowledgeController.create.bind(knowledgeController)
  );

  fastify.get(
    '/',
    { schema: { tags: ['Knowledge Bases'], summary: 'List accessible knowledge bases' } },
    knowledgeController.list.bind(knowledgeController)
  );

  fastify.get(
    '/:kbId',
    { schema: { tags: ['Knowledge Bases'], summary: 'Get knowledge base details' } },
    knowledgeController.getById.bind(knowledgeController)
  );

  fastify.post(
    '/:kbId/documents',
    { schema: { tags: ['Knowledge Bases'], summary: 'Ingest a text document into a knowledge base' } },
    knowledgeController.ingestText.bind(knowledgeController)
  );

  fastify.post(
    '/:kbId/test-retrieval',
    { schema: { tags: ['Knowledge Bases'], summary: 'Test tenant-isolated retrieval on a knowledge base' } },
    knowledgeController.testRetrieval.bind(knowledgeController)
  );
};

export default knowledgeRoutes;
