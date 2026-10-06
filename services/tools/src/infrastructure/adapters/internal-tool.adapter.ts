import type { ToolDefinition, ToolExecutionRequest } from '../../domain/index.js';
import { InvalidToolArgumentsError, ToolExecutionFailedError } from '../../domain/index.js';
import type {
  ToolExecutionContext,
  ToolExecutionOutput,
  ToolExecutorPort,
} from '../../application/ports/tool-executor.port.js';

export class InternalToolAdapter implements ToolExecutorPort {
  public async execute(
    definition: ToolDefinition,
    request: ToolExecutionRequest,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionOutput> {
    const startTime = Date.now();

    switch (definition.toolId) {
      case 'oicunt.tool.computation.evaluate': {
        const expression = request.arguments['expression'];
        if (typeof expression !== 'string' || !expression.trim()) {
          throw new InvalidToolArgumentsError("Argument 'expression' must be a non-empty string");
        }
        const result = this.safeEvaluateMath(expression);
        return {
          executionId: context.executionId,
          callId: request.callId,
          status: 'success',
          output: { result, expression },
          textSummary: `Result of expression '${expression}': ${result}`,
          durationMs: Date.now() - startTime,
        };
      }

      case 'oicunt.tool.computation.format_string': {
        const text = request.arguments['text'];
        const operation = request.arguments['operation'];
        if (typeof text !== 'string') {
          throw new InvalidToolArgumentsError("Argument 'text' must be a string");
        }
        let formatted = text;
        if (operation === 'uppercase') formatted = text.toUpperCase();
        else if (operation === 'lowercase') formatted = text.toLowerCase();
        else if (operation === 'trim') formatted = text.trim();
        else if (operation === 'slugify') {
          formatted = text
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
        }

        return {
          executionId: context.executionId,
          callId: request.callId,
          status: 'success',
          output: { formatted, original: text, operation },
          textSummary: `Formatted string: '${formatted}'`,
          durationMs: Date.now() - startTime,
        };
      }

      case 'oicunt.tool.computation.date_diff': {
        const startStr = request.arguments['startDate'];
        const endStr = request.arguments['endDate'];
        const start = new Date(String(startStr)).getTime();
        const end = new Date(String(endStr)).getTime();

        if (Number.isNaN(start) || Number.isNaN(end)) {
          throw new InvalidToolArgumentsError('Invalid date format for startDate or endDate');
        }

        const diffMs = Math.abs(end - start);
        const diffSeconds = Math.floor(diffMs / 1000);
        const diffMinutes = Math.floor(diffSeconds / 60);
        const diffHours = Math.floor(diffMinutes / 60);
        const diffDays = Math.floor(diffHours / 24);

        return {
          executionId: context.executionId,
          callId: request.callId,
          status: 'success',
          output: { diffMs, diffSeconds, diffMinutes, diffHours, diffDays },
          textSummary: `Difference: ${diffDays} days (${diffHours} hours)`,
          durationMs: Date.now() - startTime,
        };
      }

      case 'oicunt.tool.system.echo': {
        return {
          executionId: context.executionId,
          callId: request.callId,
          status: 'success',
          output: { echo: request.arguments },
          textSummary: `Echoed arguments: ${JSON.stringify(request.arguments)}`,
          durationMs: Date.now() - startTime,
        };
      }

      default:
        throw new ToolExecutionFailedError(
          `No internal handler registered for '${definition.toolId}'`,
          definition.capabilities.isReadOnly,
        );
    }
  }

  /**
   * Safe recursive descent arithmetic evaluator without using eval() or Function().
   */
  private safeEvaluateMath(expr: string): number {
    const tokens = expr.replace(/\s+/g, '').match(/(\d+(\.\d+)?|[+\-*/^()%])/g);
    if (!tokens || tokens.length === 0) {
      throw new InvalidToolArgumentsError('Invalid mathematical expression');
    }

    let pos = 0;

    function peek(): string | undefined {
      return tokens?.[pos];
    }

    function consume(): string {
      const token = tokens?.[pos];
      if (token === undefined) {
        throw new InvalidToolArgumentsError('Unexpected end of expression');
      }
      pos++;
      return token;
    }

    function parseExpression(): number {
      let value = parseTerm();
      while (peek() === '+' || peek() === '-') {
        const op = consume();
        const next = parseTerm();
        if (op === '+') value += next;
        else value -= next;
      }
      return value;
    }

    function parseTerm(): number {
      let value = parseFactor();
      while (peek() === '*' || peek() === '/' || peek() === '%') {
        const op = consume();
        const next = parseFactor();
        if (op === '*') value *= next;
        else if (op === '/') {
          if (next === 0) throw new InvalidToolArgumentsError('Division by zero');
          value /= next;
        } else if (op === '%') {
          value %= next;
        }
      }
      return value;
    }

    function parseFactor(): number {
      let value = parsePrimary();
      while (peek() === '^') {
        consume();
        const next = parsePrimary();
        value = Math.pow(value, next);
      }
      return value;
    }

    function parsePrimary(): number {
      const token = peek();
      if (token === '-') {
        consume();
        return -parsePrimary();
      }
      if (token === '+') {
        consume();
        return parsePrimary();
      }
      if (token === '(') {
        consume();
        const value = parseExpression();
        if (peek() !== ')') {
          throw new InvalidToolArgumentsError("Missing closing parenthesis ')'");
        }
        consume();
        return value;
      }

      if (token && /^\d+(\.\d+)?$/.test(token)) {
        consume();
        return Number.parseFloat(token);
      }

      throw new InvalidToolArgumentsError(`Unexpected token in math expression: '${token ?? ''}'`);
    }

    const result = parseExpression();
    if (pos < tokens.length) {
      throw new InvalidToolArgumentsError(`Unexpected token remaining: '${tokens[pos]}'`);
    }
    return result;
  }
}
