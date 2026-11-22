import { FastifyRequest, FastifyReply } from 'fastify';
import { getAuth } from '@clerk/fastify';
import env from '../config/env';

export interface AuthenticatedRequest extends FastifyRequest {
  auth?: ReturnType<typeof getAuth>;
  userId?: string;
}

/**
 * Pre-handler authentication hook.
 * Verifies that the incoming request contains a valid Clerk session/JWT.
 * If valid, decorates request with `userId` and `auth`.
 * Otherwise, immediately terminates with HTTP 401 Unauthorized.
 */
export const requireAuth = async (request: FastifyRequest, reply: FastifyReply) => {
  const isExplicitNoBypass = request.headers['x-test-bypass'] === 'false';

  // Support mock bypass in test environments if requested or if running general tests without configured Clerk keys
  if (
    process.env.NODE_ENV === 'test' &&
    !isExplicitNoBypass &&
    (request.headers['x-test-bypass'] === 'true' ||
      process.env.TEST_AUTH_BYPASS === 'true' ||
      (!env.CLERK_SECRET_KEY && !env.CLERK_PUBLISHABLE_KEY))
  ) {
    const testUserId = (request.headers['x-test-user-id'] as string) || 'test_user_id';
    (request as AuthenticatedRequest).userId = testUserId;
    return;
  }

  if (!env.CLERK_SECRET_KEY && !env.CLERK_PUBLISHABLE_KEY) {
    if (isExplicitNoBypass) {
      return reply.status(401).send({
        success: false,
        message: 'Unauthorized: Authentication required to access this endpoint',
      });
    }
    return reply.status(500).send({
      success: false,
      message: 'Server configuration error: Clerk API keys are not configured.',
    });
  }

  try {
    const auth = getAuth(request);

    if (!auth || !auth.userId) {
      return reply.status(401).send({
        success: false,
        message: 'Unauthorized: Authentication required to access this endpoint',
      });
    }

    (request as AuthenticatedRequest).auth = auth;
    (request as AuthenticatedRequest).userId = auth.userId;
  } catch (error) {
    request.log.error({ error }, 'Clerk authentication error');
    return reply.status(401).send({
      success: false,
      message: 'Unauthorized: Invalid or expired authentication token',
    });
  }
};

/**
 * Optional authentication hook.
 * Attaches auth credentials if present, but does not reject unauthenticated requests.
 */
export const optionalAuth = async (request: FastifyRequest) => {
  try {
    const auth = getAuth(request);
    if (auth?.userId) {
      (request as AuthenticatedRequest).auth = auth;
      (request as AuthenticatedRequest).userId = auth.userId;
    }
  } catch {
    // Non-blocking for optional auth
  }
};

export default requireAuth;
