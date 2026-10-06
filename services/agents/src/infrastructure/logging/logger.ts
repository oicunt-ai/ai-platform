export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LogContext {
  readonly service?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly userId?: string | undefined;
  readonly actorId?: string | undefined;
  readonly agentId?: string | undefined;
  readonly runId?: string | undefined;
  readonly stepNumber?: number | undefined;
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
  'thinking',
  'rawthinking',
  'chain_of_thought',
  'cot',
  'reasoning_content',
];

export class JsonLogger {
  private readonly serviceName: string;
  private readonly minLevel: LogLevel;
  private readonly defaultContext: LogContext;

  constructor(
    serviceName = 'agents',
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

    return (levels[level] ?? 20) < (levels[this.minLevel] ?? 20);
  }

  private sanitizeRecord(record: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(record)) {
      if (this.isSensitiveKey(key)) {
        sanitized[key] = '[REDACTED]';
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeRecord(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private isSensitiveKey(key: string): boolean {
    const lower = key.toLowerCase();
    return SENSITIVE_KEYS.some((sensitive) => lower.includes(sensitive));
  }
}
