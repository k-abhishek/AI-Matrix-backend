import crypto from 'crypto';
import { DiscoveredTool } from '../base.adapter';
import { BadRequestError } from '../../../lib/errors';
import logger from '../../../lib/logger';

export interface OpenApiEndpointMeta {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  operationId?: string;
  parameters: Array<{
    name: string;
    in: 'path' | 'query' | 'header' | 'cookie';
    required?: boolean;
    description?: string;
    schema?: Record<string, any>;
  }>;
  requestBodySchema?: Record<string, any>;
}

export class OpenApiParserService {
  /**
   * Parses an OpenAPI 3.0 or Swagger 2.0 specification object and extracts
   * platform DiscoveredTool records with normalized JSON Schemas.
   */
  parse(spec: Record<string, any>): DiscoveredTool[] {
    if (!spec || typeof spec !== 'object') {
      throw new BadRequestError('Invalid OpenAPI specification: must be an object');
    }

    const paths = spec.paths;
    if (!paths || typeof paths !== 'object') {
      throw new BadRequestError('OpenAPI specification missing "paths" object');
    }

    const discoveredTools: DiscoveredTool[] = [];
    const supportedMethods = ['get', 'post', 'put', 'delete', 'patch'] as const;

    for (const [rawPath, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue;

      // Extract path-level parameters
      const pathLevelParams = Array.isArray((pathItem as any).parameters)
        ? (pathItem as any).parameters
        : [];

      for (const method of supportedMethods) {
        const operation = (pathItem as any)[method];
        if (!operation || typeof operation !== 'object') continue;

        const tool = this.convertOperationToTool(
          rawPath,
          method.toUpperCase() as any,
          operation,
          pathLevelParams
        );

        if (tool) {
          discoveredTools.push(tool);
        }
      }
    }

    return discoveredTools;
  }

  /**
   * Converts a single OpenAPI path + HTTP method operation into a DiscoveredTool.
   */
  private convertOperationToTool(
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    operation: Record<string, any>,
    pathLevelParams: any[] = []
  ): DiscoveredTool {
    // 1. Generate clean tool name: prefer operationId, otherwise method_path
    let rawName = operation.operationId;
    if (!rawName) {
      const cleanPath = path
        .replace(/\{([^}]+)\}/g, 'by_$1')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
      rawName = `${method.toLowerCase()}_${cleanPath}`;
    }

    const sanitizedName = rawName
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 64);

    const displayName =
      operation.summary ||
      operation.operationId ||
      `${method} ${path}`;

    const description = (
      operation.description ||
      operation.summary ||
      `Performs ${method} request to ${path}`
    ).slice(0, 500);

    // 2. Synthesize unified input schema
    const properties: Record<string, any> = {};
    const required: string[] = [];

    // Combine path-level and operation-level parameters
    const allParams = [...pathLevelParams, ...(Array.isArray(operation.parameters) ? operation.parameters : [])];

    for (const param of allParams) {
      if (!param || !param.name) continue;
      const paramSchema = param.schema || { type: param.type || 'string' };

      properties[param.name] = {
        type: paramSchema.type || 'string',
        description: param.description || `${param.in} parameter: ${param.name}`,
        ...(paramSchema.enum ? { enum: paramSchema.enum } : {}),
        ...(paramSchema.default !== undefined ? { default: paramSchema.default } : {}),
      };

      if (param.required || param.in === 'path') {
        if (!required.includes(param.name)) {
          required.push(param.name);
        }
      }
    }

    // Process requestBody (OpenAPI 3.0)
    let requestBodySchema: Record<string, any> | undefined;
    if (operation.requestBody?.content?.['application/json']?.schema) {
      requestBodySchema = operation.requestBody.content['application/json'].schema;
      if (requestBodySchema?.type === 'object' && requestBodySchema.properties) {
        for (const [propName, propDef] of Object.entries(requestBodySchema.properties)) {
          properties[propName] = propDef;
        }
        if (Array.isArray(requestBodySchema.required)) {
          for (const reqField of requestBodySchema.required) {
            if (!required.includes(reqField)) {
              required.push(reqField);
            }
          }
        }
      } else {
        properties['body'] = requestBodySchema;
        if (operation.requestBody.required) {
          required.push('body');
        }
      }
    }

    const inputSchema: Record<string, any> = {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };

    const isMutating = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);

    return {
      name: sanitizedName,
      displayName,
      description,
      inputSchema,
      requiresApproval: isMutating,
    };
  }

  /**
   * Computes a deterministic SHA-256 schema hash for version change detection.
   */
  calculateSchemaHash(inputSchema: Record<string, any>): string {
    const serialized = JSON.stringify(inputSchema, Object.keys(inputSchema).sort());
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }
}

export const openApiParserService = new OpenApiParserService();
export default openApiParserService;
