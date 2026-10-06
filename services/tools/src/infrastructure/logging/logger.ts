export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LogContext {
  readonly service?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly userId?: string | undefined;
  readonly actorId?: string | undefined;
  readonly toolId?: string | undefined;
  readonly version?: string | undefined;
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
  'confirmationtoken',
  'challengetoken',
];

export class JsonLogger {
  private readonly serviceName: string;
  private readonly minLevel: LogLevel;
  private readonly defaultContext: LogContext;

  constructor(serviceName = 'tools', minLevel: LogLevel = 'info', defaultContext: LogContext = {}) {
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
      ...context,
    };

    const sanitizedContext = this.sanitizeRecord(merged as Record<string, unknown>);

    const record = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      message,
      ...sanitizedContext,
    };

    const output = JSON.stringify(record);
    if (level === 'error') {
      process.stderr.write(output + '\n');
    } else {
      process.stdout.write(output + '\n');
    }
  }

  private shouldSkip(level: LogLevel): boolean {
    if (this.minLevel === 'silent') {
      return true;
    }

    const levels: Record<LogLevel, number> = {
      debug: 10,
      info: 20,
      warn: 30,
      error: 40,
      silent: 100,
    };

    return levels[level] < levels[this.minLevel];
  }

  private sanitize(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitize(item));
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (SENSITIVE_KEYS.some((sensitive) => lower.includes(sensitive))) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.sanitize(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private sanitizeRecord(obj: Record<string, unknown>): Record<string, unknown> {
    return this.sanitize(obj) as Record<string, unknown>;
  }
}
