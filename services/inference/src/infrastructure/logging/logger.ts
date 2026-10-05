export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LogContext {
  readonly service?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly conversationId?: string | undefined;
  readonly model?: string | undefined;
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
];

export class JsonLogger {
  private readonly serviceName: string;
  private readonly minLevel: LogLevel;
  private readonly defaultContext: LogContext;

  constructor(
    serviceName = 'inference',
    minLevel: LogLevel = 'info',
    defaultContext: LogContext = {},
  ) {
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

    const payload = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      service: this.serviceName,
      message,
      ...this.sanitize({ ...this.defaultContext, ...context }),
    };

    const serialized = JSON.stringify(payload);
    if (level === 'error') {
      process.stderr.write(`${serialized}\n`);
    } else {
      process.stdout.write(`${serialized}\n`);
    }
  }

  private shouldSkip(level: LogLevel): boolean {
    if (this.minLevel === 'silent') return true;
    const hierarchy: Record<LogLevel, number> = {
      debug: 10,
      info: 20,
      warn: 30,
      error: 40,
      silent: 50,
    };
    return hierarchy[level] < hierarchy[this.minLevel];
  }

  private sanitize(obj: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s))) {
        sanitized[key] = '[REDACTED]';
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        sanitized[key] = this.sanitize(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}
