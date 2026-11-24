import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import connectorService from './connector.service';

export const catalogQuerySchema = z.object({
  type: z.enum(['NATIVE', 'MCP', 'CUSTOM_REST']).optional(),
  search: z.string().optional(),
});

export class ConnectorController {
  async getCatalog(req: FastifyRequest, reply: FastifyReply) {
    const query = catalogQuerySchema.parse(req.query);
    const catalog = await connectorService.listCatalog(query);
    return reply.status(200).send({
      success: true,
      data: catalog,
    });
  }

  async getDefinitionByKey(req: FastifyRequest<{ Params: { key: string } }>, reply: FastifyReply) {
    const { key } = req.params;
    const definition = await connectorService.getDefinitionByKey(key);
    return reply.status(200).send({
      success: true,
      data: definition,
    });
  }
}

export const connectorController = new ConnectorController();
export default connectorController;
