import { describe, it, expect, vi, beforeEach } from 'vitest';
import openApiParserService from '../../src/modules/adapters/rest/openapi-parser.service';
import customRestConnectorAdapter from '../../src/modules/adapters/rest/custom-rest.adapter';
import ssrfGuard from '../../src/lib/network/ssrf-guard';

describe('Custom REST Connector Adapter & OpenAPI Parser (Phase 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const petstoreSpec = {
    openapi: '3.0.0',
    info: { title: 'Petstore API', version: '1.0.0' },
    servers: [{ url: 'https://petstore.example.com/v1' }],
    paths: {
      '/pets': {
        get: {
          operationId: 'listPets',
          summary: 'List all pets',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              description: 'How many items to return',
              required: false,
              schema: { type: 'integer' },
            },
            {
              name: 'status',
              in: 'query',
              schema: { type: 'string', enum: ['available', 'pending', 'sold'] },
            },
          ],
          responses: { '200': { description: 'Success' } },
        },
        post: {
          operationId: 'createPet',
          summary: 'Create a new pet',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string' },
                    tag: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Created' } },
        },
      },
      '/pets/{petId}': {
        get: {
          operationId: 'getPetById',
          summary: 'Info for a specific pet',
          parameters: [
            {
              name: 'petId',
              in: 'path',
              required: true,
              description: 'The id of the pet to retrieve',
              schema: { type: 'string' },
            },
          ],
        },
        delete: {
          operationId: 'deletePet',
          summary: 'Delete a pet by ID',
          parameters: [
            {
              name: 'petId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
        },
      },
    },
  };

  describe('OpenApiParserService', () => {
    it('parses OpenAPI 3.0 specification into DiscoveredTool records', () => {
      const tools = openApiParserService.parse(petstoreSpec);

      expect(tools.length).toBe(4);
      const names = tools.map((t) => t.name);
      expect(names).toContain('listPets');
      expect(names).toContain('createPet');
      expect(names).toContain('getPetById');
      expect(names).toContain('deletePet');
    });

    it('extracts query and path parameters into tool inputSchema', () => {
      const tools = openApiParserService.parse(petstoreSpec);
      const listPetsTool = tools.find((t) => t.name === 'listPets')!;

      expect(listPetsTool.inputSchema.properties.limit).toBeDefined();
      expect(listPetsTool.inputSchema.properties.status.enum).toContain('available');
      expect(listPetsTool.requiresApproval).toBe(false); // GET is non-mutating

      const getPetTool = tools.find((t) => t.name === 'getPetById')!;
      expect(getPetTool.inputSchema.properties.petId).toBeDefined();
      expect(getPetTool.inputSchema.required).toContain('petId');
    });

    it('merges requestBody properties and flags mutating tools with requiresApproval: true', () => {
      const tools = openApiParserService.parse(petstoreSpec);
      const createPetTool = tools.find((t) => t.name === 'createPet')!;

      expect(createPetTool.inputSchema.properties.name).toBeDefined();
      expect(createPetTool.inputSchema.required).toContain('name');
      expect(createPetTool.requiresApproval).toBe(true); // POST is mutating

      const deletePetTool = tools.find((t) => t.name === 'deletePet')!;
      expect(deletePetTool.requiresApproval).toBe(true); // DELETE is mutating
    });

    it('calculates deterministic SHA-256 schema hash', () => {
      const schema = { type: 'object', properties: { id: { type: 'string' } } };
      const hash1 = openApiParserService.calculateSchemaHash(schema);
      const hash2 = openApiParserService.calculateSchemaHash(schema);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });
  });

  describe('CustomRestConnectorAdapter.executeTool', () => {
    it('interpolates path parameters and queries for GET requests', async () => {
      vi.spyOn(ssrfGuard, 'assertSafeUrl').mockImplementation(async (url) => url);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ id: 'pet-42', name: 'Buddy' }),
      });
      globalThis.fetch = mockFetch;

      const result = await customRestConnectorAdapter.executeTool(
        'getPetById',
        { petId: '42' },
        {
          connectionId: 'conn-rest-1',
          workspaceId: 'ws-1',
          baseUrl: 'https://api.petstore.com/v1',
          config: {
            endpoints: [
              {
                name: 'getPetById',
                path: '/pets/{petId}',
                method: 'GET',
              },
            ],
          },
          credentials: {
            token: 'test_bearer_token',
          },
        }
      );

      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Buddy');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.petstore.com/v1/pets/42',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test_bearer_token',
          }),
        })
      );
    });

    it('serializes JSON body for POST requests', async () => {
      vi.spyOn(ssrfGuard, 'assertSafeUrl').mockImplementation(async (url) => url);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: { get: () => 'application/json' },
        json: async () => ({ id: 'new-pet-1', name: 'Milo', tag: 'puppy' }),
      });
      globalThis.fetch = mockFetch;

      const result = await customRestConnectorAdapter.executeTool(
        'createPet',
        { name: 'Milo', tag: 'puppy' },
        {
          connectionId: 'conn-rest-1',
          workspaceId: 'ws-1',
          baseUrl: 'https://api.petstore.com/v1',
          config: {
            endpoints: [
              {
                name: 'createPet',
                path: '/pets',
                method: 'POST',
              },
            ],
          },
        }
      );

      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Milo');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.petstore.com/v1/pets',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Milo', tag: 'puppy' }),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('rejects SSRF attempts by throwing or returning failure', async () => {
      vi.spyOn(ssrfGuard, 'assertSafeUrl').mockRejectedValue(
        new Error('Target IP address belongs to a private subnet')
      );

      const result = await customRestConnectorAdapter.executeTool(
        'listPets',
        {},
        {
          connectionId: 'conn-rest-1',
          workspaceId: 'ws-1',
          baseUrl: 'http://169.254.169.254',
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Target IP address belongs to a private subnet');
    });

    it('handles non-2xx HTTP responses gracefully', async () => {
      vi.spyOn(ssrfGuard, 'assertSafeUrl').mockImplementation(async (url) => url);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: { get: () => 'application/json' },
        json: async () => ({ error: 'Pet not found' }),
      });
      globalThis.fetch = mockFetch;

      const result = await customRestConnectorAdapter.executeTool(
        'getPetById',
        { petId: '9999' },
        {
          connectionId: 'conn-rest-1',
          workspaceId: 'ws-1',
          baseUrl: 'https://api.petstore.com/v1',
          config: {
            endpoints: [{ name: 'getPetById', path: '/pets/{petId}', method: 'GET' }],
          },
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 404 Not Found');
    });
  });
});
