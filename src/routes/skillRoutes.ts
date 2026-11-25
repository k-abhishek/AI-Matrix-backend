import { FastifyPluginAsync } from 'fastify';
import skillController from '../modules/skills/skill.controller';
import { requireAuth } from '../middleware/auth';

const skillRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  fastify.post('/', { schema: { tags: ['Skills'], summary: 'Create a custom skill' } }, skillController.create.bind(skillController));
  fastify.get('/', { schema: { tags: ['Skills'], summary: 'List available skills' } }, skillController.list.bind(skillController));
  fastify.get('/:skillId', { schema: { tags: ['Skills'], summary: 'Get skill details and versions' } }, skillController.getById.bind(skillController));
  fastify.patch('/:skillId', { schema: { tags: ['Skills'], summary: 'Update skill draft' } }, skillController.update.bind(skillController));
  fastify.post('/:skillId/validate', { schema: { tags: ['Skills'], summary: 'Validate skill draft' } }, skillController.validate.bind(skillController));
  fastify.post('/:skillId/publish', { schema: { tags: ['Skills'], summary: 'Publish skill version' } }, skillController.publish.bind(skillController));
  fastify.post('/:skillId/test', { schema: { tags: ['Skills'], summary: 'Test skill in isolated dry run' } }, skillController.test.bind(skillController));
};

export default skillRoutes;

