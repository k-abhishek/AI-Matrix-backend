import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { requireAuth } from '../../src/middleware/auth';

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
});
