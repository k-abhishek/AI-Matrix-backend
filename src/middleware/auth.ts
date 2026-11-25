import { FastifyRequest, FastifyReply } from 'fastify';
import { getAuth } from '@clerk/fastify';
import env from '../config/env';

export interface AuthenticatedRequest extends FastifyRequest {
  auth?: ReturnType<typeof getAuth>;
  userId?: string;
  workspaceId?: string;
  orgId?: string;
  orgRole?: string;
  orgPermissions?: string[];
}

export interface WorkspaceContext {
  workspaceId: string;
  userId: string;
  orgId?: string;
  orgRole?: string;
  orgPermissions?: string[];
  isOrganization: boolean;
}

export const WORKSPACE_ADMIN_ROLES = ['org:admin'] as const;
export const WORKSPACE_EDITOR_ROLES = ['org:admin', 'org:editor'] as const;
export const WORKSPACE_MEMBER_ROLES = ['org:admin', 'org:editor', 'org:member'] as const;

/**
 * Extracts normalized workspace and user context from an authenticated request.
 * Prefers Clerk organization ID (`orgId`), falling back to `userId` for solo/personal workspaces.
 */
export const getWorkspaceContext = (request: FastifyRequest): WorkspaceContext => {
  const authReq = request as AuthenticatedRequest;
  const userId = authReq.userId || authReq.auth?.userId || '';
  const orgId = authReq.orgId || authReq.auth?.orgId || undefined;
  const orgRole = authReq.orgRole || authReq.auth?.orgRole || undefined;
  const orgPermissions =
    authReq.orgPermissions || (authReq.auth?.orgPermissions as string[] | undefined) || undefined;
  const workspaceId = authReq.workspaceId || orgId || userId;

  return {
    workspaceId,
    userId,
    orgId,
    orgRole,
    orgPermissions,
    isOrganization: Boolean(orgId),
  };
};

/**
 * Pre-handler authentication hook.
 * Verifies that the incoming request contains a valid Clerk session/JWT.
 * If valid, decorates request with `userId`, `workspaceId`, `orgId`, `orgRole`, `orgPermissions`, and `auth`.
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
    const testOrgId = (request.headers['x-test-org-id'] as string) || undefined;
    const testOrgRole = (request.headers['x-test-org-role'] as string) || undefined;
    const authReq = request as AuthenticatedRequest;
    authReq.userId = testUserId;
    authReq.orgId = testOrgId;
    authReq.orgRole = testOrgRole;
    authReq.workspaceId = testOrgId || testUserId;
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

    const authReq = request as AuthenticatedRequest;
    authReq.auth = auth;
    authReq.userId = auth.userId;
    authReq.orgId = auth.orgId || undefined;
    authReq.orgRole = auth.orgRole || undefined;
    authReq.orgPermissions = Array.isArray(auth.orgPermissions)
      ? auth.orgPermissions
      : undefined;
    authReq.workspaceId = auth.orgId || auth.userId;
  } catch (error) {
    request.log.error({ error }, 'Clerk authentication error');
    return reply.status(401).send({
      success: false,
      message: 'Unauthorized: Invalid or expired authentication token',
    });
  }
};

/**
 * Pre-handler hook requiring an active Clerk organization context (`orgId`).
 */
export const requireOrg = async (request: FastifyRequest, reply: FastifyReply) => {
  const { orgId } = getWorkspaceContext(request);
  if (!orgId) {
    return reply.status(403).send({
      success: false,
      message: 'Forbidden: An active Clerk organization is required for this endpoint',
    });
  }
};

/**
 * Pre-handler factory enforcing Clerk organization role membership.
 * In personal workspace mode (no `orgId`), the authenticated user is the owner and allowed.
 */
export const requireWorkspaceRole = (allowedRoles: readonly string[]) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { isOrganization, orgRole } = getWorkspaceContext(request);
    if (!isOrganization) {
      return;
    }

    if (!orgRole || !allowedRoles.includes(orgRole)) {
      return reply.status(403).send({
        success: false,
        message: 'Forbidden: Insufficient organization role permissions',
      });
    }
  };
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
