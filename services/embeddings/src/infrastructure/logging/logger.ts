export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LogContext {
  readonly correlationId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly model?: string | undefined;
  readonly modelVersion?: string | undefined;
  readonly batchSize?: number | undefined;
  readonly totalCharacters?: number | undefined;
  readonly promptTokens?: number | undefined;
  readonly dimensions?: number | undefined;
  readonly latencyMs?: number | undefined;
  readonly error?: unknown | undefined;
  readonly [key: string]: unknown;
}

const FORBIDDEN_LOG_KEYS = new Set([
  'inputs',
  'input',
  'text',
  'texts',
  'prompt',
  'vector',
  'vectors',
  'embeddings',
  'embedding',
  'raw_vector',
  'authorization',
  'token',
  'key',
  'api_key',
  'apikey',
  'secret',
  'password',
]);

export class JsonLogger {
  constructor(
    private readonly serviceName = 'embeddings',
    private readonly minLevel: LogLevel = 'info',
  ) {}

  public debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      this.write('DEBUG', message, context);
    }
  }

  public info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      this.write('INFO', message, context);
    }
  }

  public warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      this.write('WARN', message, context);
    }
  }

  public error(message: string, context?: LogContext): void {
    if (this.shouldLog('error')) {
      this.write('ERROR', message, context);
    }
  }

  private shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
    if (this.minLevel === 'silent') return false;
    const levels = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  private write(level: string, message: string, context?: LogContext): void {
    // SECURITY INVARIANT: Input texts and floating-point vector arrays are NEVER serialized into logs!
    const logObj: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      service: this.serviceName,
      level,
      message,
    };

    if (context) {
      for (const [key, value] of Object.entries(context)) {
        if (FORBIDDEN_LOG_KEYS.has(key.toLowerCase())) {
          continue;
        }

        if (key === 'error') {
          if (value instanceof Error) {
            logObj['error'] = {
              name: value.name,
              message: value.message,
              stack: value.stack,
            };
          } else {
            logObj['error'] = String(value);
          }
        } else {
          logObj[key] = value;
        }
      }
    }

    const output = JSON.stringify(logObj);
    if (level === 'ERROR') {
      process.stderr.write(`${output}\n`);
    } else {
      process.stdout.write(`${output}\n`);
    }
  }
}

export type EmbeddingsLogger = JsonLogger;
