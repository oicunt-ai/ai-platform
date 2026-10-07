export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LogContext {
  readonly service?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly serverId?: string | undefined;
  readonly toolName?: string | undefined;
  readonly durationMs?: number | undefined;
  readonly [key: string]: unknown;
}

const SENSITIVE_KEYS = [
  'authorization',
  'api_key',
  'apikey',
  'secret',
  'password',
  'token',
  'credentials',
  'authsecretref',
];

export class JsonLogger {
  private readonly serviceName: string;
  private readonly minLevel: LogLevel;
  private readonly defaultContext: LogContext;

  constructor(serviceName = 'mcp', minLevel: LogLevel = 'info', defaultContext: LogContext = {}) {
    this.serviceName = serviceName;
    this.minLevel = minLevel;
    this.defaultContext = defaultContext;
  }

  public debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  public info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  public warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  public error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  public child(context: LogContext): JsonLogger {
    return new JsonLogger(this.serviceName, this.minLevel, {
      ...this.defaultContext,
      ...context,
    });
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (this.shouldSkip(level)) {
      return;
    }

    const merged = {
      ...this.defaultContext,
      ...(context ?? {}),
    };

    const sanitized = this.sanitizeContext(merged);

    const record = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      message,
      ...sanitized,
    };

    const serialized = JSON.stringify(record);
    if (level === 'error') {
      process.stderr.write(serialized + '\n');
    } else {
      process.stdout.write(serialized + '\n');
    }
  }

  private shouldSkip(level: LogLevel): boolean {
    const priority: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
      silent: 4,
    };

    return priority[level] < priority[this.minLevel];
  }

  private sanitizeContext(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.some((sk) => key.toLowerCase().includes(sk))) {
        result[key] = '[REDACTED]';
        continue;
      }

      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !(value instanceof Error)
      ) {
        result[key] = this.sanitizeContext(value as Record<string, unknown>);
      } else if (value instanceof Error) {
        result[key] = {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      } else {
        result[key] = value;
      }
    }

    return result;
  }
}
