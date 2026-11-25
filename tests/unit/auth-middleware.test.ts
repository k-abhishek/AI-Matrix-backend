import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import {
  requireAuth,
  requireOrg,
  requireWorkspaceRole,
  getWorkspaceContext,
  WORKSPACE_ADMIN_ROLES,
  WORKSPACE_EDITOR_ROLES,
} from '../../src/middleware/auth';

describe('requireAuth Middleware', () => {
  it('returns 401 when request is unauthenticated', async () => {
    const fastify = Fastify({ logger: false });

    fastify.get('/protected', { preHandler: requireAuth }, async () => {
      return { success: true };
    });

    await fastify.ready();

    // Send request with x-test-bypass: false to simulate live unauthenticated request
    const response = await fastify.inject({
      method: 'GET',
      url: '/protected',
      headers: {
        'x-test-bypass': 'false',
      },
    });

    expect(response.statusCode).toBe(401);
    const json = response.json();
    expect(json.success).toBe(false);
    expect(json.message).toContain('Unauthorized');
  });

  it('allows request when valid test authentication is provided', async () => {
    const fastify = Fastify({ logger: false });

    fastify.get('/protected', { preHandler: requireAuth }, async (req) => {
      return { success: true, userId: (req as any).userId };
    });

    await fastify.ready();

    const response = await fastify.inject({
      method: 'GET',
      url: '/protected',
      headers: {
        'x-test-bypass': 'true',
        'x-test-user-id': 'user_clerk_123',
      },
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.success).toBe(true);
    expect(json.userId).toBe('user_clerk_123');
  });

  it('extracts orgId, orgRole, and resolves workspaceId to orgId when present', async () => {
    const fastify = Fastify({ logger: false });

    fastify.get('/org', { preHandler: requireAuth }, async (req) => {
      return getWorkspaceContext(req);
    });

    await fastify.ready();

    const response = await fastify.inject({
      method: 'GET',
      url: '/org',
      headers: {
        'x-test-bypass': 'true',
        'x-test-user-id': 'user_123',
        'x-test-org-id': 'org_abc',
        'x-test-org-role': 'org:editor',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      workspaceId: 'org_abc',
      userId: 'user_123',
      orgId: 'org_abc',
      orgRole: 'org:editor',
      isOrganization: true,
    });
  });

  it('requireOrg rejects personal requests without orgId and allows org requests', async () => {
    const fastify = Fastify({ logger: false });
    fastify.get('/org-only', { preHandler: [requireAuth, requireOrg] }, async () => ({ ok: true }));
    await fastify.ready();

    const denied = await fastify.inject({
      method: 'GET',
      url: '/org-only',
      headers: { 'x-test-bypass': 'true', 'x-test-user-id': 'user_123' },
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await fastify.inject({
      method: 'GET',
      url: '/org-only',
      headers: {
        'x-test-bypass': 'true',
        'x-test-user-id': 'user_123',
        'x-test-org-id': 'org_abc',
      },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('requireWorkspaceRole enforces org role hierarchy and allows solo personal mode', async () => {
    const fastify = Fastify({ logger: false });
    fastify.post(
      '/admin-only',
      { preHandler: [requireAuth, requireWorkspaceRole(WORKSPACE_ADMIN_ROLES)] },
      async () => ({ ok: true })
    );
    fastify.post(
      '/editor-only',
      { preHandler: [requireAuth, requireWorkspaceRole(WORKSPACE_EDITOR_ROLES)] },
      async () => ({ ok: true })
    );
    await fastify.ready();

    const memberRes = await fastify.inject({
      method: 'POST',
      url: '/admin-only',
      headers: {
        'x-test-bypass': 'true',
        'x-test-user-id': 'user_1',
        'x-test-org-id': 'org_1',
        'x-test-org-role': 'org:member',
      },
    });
    expect(memberRes.statusCode).toBe(403);

    const editorRes = await fastify.inject({
      method: 'POST',
      url: '/editor-only',
      headers: {
        'x-test-bypass': 'true',
        'x-test-user-id': 'user_1',
        'x-test-org-id': 'org_1',
        'x-test-org-role': 'org:editor',
      },
    });
    expect(editorRes.statusCode).toBe(200);

    const personalRes = await fastify.inject({
      method: 'POST',
      url: '/admin-only',
      headers: { 'x-test-bypass': 'true', 'x-test-user-id': 'user_1' },
    });
    expect(personalRes.statusCode).toBe(200);
  });
});
