import { FastifyRequest, FastifyReply } from 'fastify';

export const notFoundHandler = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  reply.status(404).send({
    success: false,
    message: 'API route not found',
    path: request.url,
  });
};

export default notFoundHandler;
