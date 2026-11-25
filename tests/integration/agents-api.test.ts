import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import buildApp from '../../src/app';
import agentService from '../../src/modules/agents/agent.service';

describe('Agents API Endpoints (Step 1)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/agents creates an agent and passes Clerk org context', async () => {
    const spy = vi.spyOn(agentService, 'createAgent').mockResolvedValue({
      agent: { id: 'agent-uuid-1', name: 'Researcher', workspaceId: 'org_123' } as any,
      draftVersion: { id: 'ver-uuid-1', versionNumber: 1, status: 'DRAFT' } as any,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents',
      headers: {
        'x-test-bypass': 'true',
        'x-test-user-id': 'user_1',
        'x-test-org-id': 'org_123',
        'x-test-org-role': 'org:admin',
      },
      payload: {
        name: 'Researcher',
        visibility: 'WORKSPACE',
        systemInstructions: 'Analyze documents carefully.',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().success).toBe(true);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'org_123',
        userId: 'user_1',
        orgRole: 'org:admin',
        isOrganization: true,
      }),
      expect.objectContaining({ name: 'Researcher', visibility: 'WORKSPACE' })
    );
  });

  it('POST /api/agents/:agentId/publish publishes the draft version', async () => {
    vi.spyOn(agentService, 'publishAgent').mockResolvedValue({
      agent: { id: 'agent-uuid-1', activeVersionId: 'ver-uuid-1' } as any,
      publishedVersion: { id: 'ver-uuid-1', status: 'PUBLISHED', versionNumber: 1 } as any,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-uuid-1/publish',
      headers: {
        'x-test-bypass': 'true',
        'x-test-user-id': 'user_1',
        'x-test-org-id': 'org_123',
        'x-test-org-role': 'org:editor',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.publishedVersion.status).toBe('PUBLISHED');
  });

  it('POST /api/agents/:agentId/versions/:versionId/revoke revokes a version', async () => {
    vi.spyOn(agentService, 'revokeVersion').mockResolvedValue({
      id: 'ver-uuid-1',
      status: 'REVOKED',
    } as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-uuid-1/versions/ver-uuid-1/revoke',
      headers: {
        'x-test-bypass': 'true',
        'x-test-user-id': 'user_1',
        'x-test-org-id': 'org_123',
        'x-test-org-role': 'org:admin',
      },
      payload: { reason: 'Security policy update' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('REVOKED');
  });
});
