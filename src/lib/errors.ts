import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import logger from './logger';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = true;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details?: unknown) {
    super(message, 404, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required or invalid credentials', details?: unknown) {
    super(message, 401, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden for current permissions', details?: unknown) {
    super(message, 403, details);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Invalid request payload or parameters', details?: unknown) {
    super(message, 400, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict or operation already in progress', details?: unknown) {
    super(message, 409, details);
  }
}

export class SSRError extends AppError {
  constructor(message = 'Target URL violates security policy (private/local address forbidden)', details?: unknown) {
    super(message, 400, details);
  }
}

export class StorageBudgetExceededError extends AppError {
  constructor(message = 'Storage budget threshold reached', details?: unknown) {
    super(message, 507, details); // 507 Insufficient Storage
  }
}

export const errorHandler = (
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): void => {
  // Handle Zod validation errors
  if (
    error instanceof ZodError ||
    (error as any).name === 'ZodError' ||
    (error as any).constructor?.name === 'ZodError' ||
    Array.isArray((error as any).issues)
  ) {
    const issues = ((error as any).issues || []).map((i: any) => ({
      field: Array.isArray(i.path) ? i.path.join('.') : String(i.path || ''),
      message: i.message,
    }));
    logger.warn(`Validation error on ${request.method} ${request.url}:`, { issues });
    reply.status(400).send({
      success: false,
      message: 'Validation failed',
      errors: issues,
    });
    return;
  }

  // Handle Fastify AJV schema validation errors
  if ((error as any).validation) {
    const issues = ((error as any).validation || []).map((v: any) => ({
      field: v.instancePath ? v.instancePath.replace(/^\//, '') : (v.params?.missingProperty || ''),
      message: v.message || 'Validation failed',
    }));
    logger.warn(`Schema validation error on ${request.method} ${request.url}:`, { issues });
    reply.status(400).send({
      success: false,
      message: 'Validation failed',
      errors: issues,
    });
    return;
  }

  // Handle custom AppErrors
  if (error instanceof AppError) {
    logger.warn(`Operational error on ${request.method} ${request.url}: ${error.message}`);
    reply.status(error.statusCode).send({
      success: false,
      message: error.message,
      details: error.details,
    });
    return;
  }

  const statusCode = (error as FastifyError).statusCode || 500;
  const message = error.message || 'Internal Server Error';

  logger.error(`Unhandled error on ${request.method} ${request.url}: ${message}`, error);

  reply.status(statusCode).send({
    success: false,
    message: statusCode >= 500 ? 'An unexpected error occurred' : message,
  });
};

export default errorHandler;
