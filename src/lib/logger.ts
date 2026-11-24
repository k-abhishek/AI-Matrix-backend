import { FastifyPluginAsync } from 'fastify';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITIES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bright: '\x1b[1m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITIES[level] >= LEVEL_PRIORITIES[this.level];
  }

  private formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const color =
      level === 'error'
        ? COLORS.red
        : level === 'warn'
        ? COLORS.yellow
        : level === 'debug'
        ? COLORS.dim
        : COLORS.green;

    let contextStr = '';
    if (context && Object.keys(context).length > 0) {
      // Filter out any potential sensitive fields
      const sanitized = { ...context };
      delete sanitized.apiKey;
      delete sanitized.password;
      delete sanitized.authorization;
      delete sanitized.secret;
      delete sanitized.token;

      contextStr = ` ${COLORS.cyan}${JSON.stringify(sanitized)}${COLORS.reset}`;
    }

    return `${COLORS.dim}[${timestamp}]${COLORS.reset} ${color}[${level.toUpperCase()}]${COLORS.reset} ${message}${contextStr}`;
  }

  debug(message: string, context?: Record<string, unknown>) {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, context));
    }
  }

  info(message: string, context?: Record<string, unknown>) {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, context));
    }
  }

  warn(message: string, context?: Record<string, unknown>) {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  error(message: string, contextOrError?: unknown, context?: Record<string, unknown>) {
    if (this.shouldLog('error')) {
      if (contextOrError instanceof Error) {
        console.error(
          this.formatMessage('error', `${message} - ${contextOrError.message}`, {
            ...context,
            stack: contextOrError.stack,
          })
        );
      } else if (typeof contextOrError === 'object' && contextOrError !== null) {
        console.error(this.formatMessage('error', message, contextOrError as Record<string, unknown>));
      } else {
        console.error(this.formatMessage('error', message, context));
      }
    }
  }
}

export const logger = new Logger(
  (process.env.LOG_LEVEL as LogLevel) || 'info'
);

export const requestLogger: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request) => {
    logger.debug(`Incoming ${request.method} request to ${request.url}`);
  });

  fastify.addHook('onResponse', async (request, reply) => {
    logger.info(`${request.method} ${request.url} - ${reply.statusCode}`);
  });
};

export default logger;
