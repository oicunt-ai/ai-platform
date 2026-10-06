import type { ChatMessage, MessageContentPart } from '@oicunt-ai/ai-types';
import type { TokenUsage } from '@oicunt-ai/model-types';
import type { ToolCall } from '@oicunt-ai/tool-types';
import type { AgentCheckpoint, AgentRun, AgentStep, AgentVersion } from '../../domain/entities.js';
import {
  BudgetExceededError,
  ConsecutiveErrorsExceededError,
  DeadlineExceededError,
  InferenceFailureError,
  PolicyViolationError,
  StepLimitExceededError,
} from '../../domain/errors.js';
import type { AgentRunStatus, AgentStepId, TerminationReason } from '../../domain/types.js';
import type {
  AgentConfirmationChallenge,
  AgentInputChallenge,
  Observation,
} from '../../domain/value-objects.js';
import type { AgentStreamEvent } from '../dtos/agent-run-response.dto.js';
import type { ResumeRunDto } from '../dtos/resume-run.dto.js';
import type { InferenceClientPort, RunRepositoryPort, ToolsClientPort } from '../ports/index.js';

export interface ExecuteRunLoopOptions {
  readonly signal?: AbortSignal | undefined;
  readonly onEvent?: ((event: AgentStreamEvent) => void) | undefined;
  readonly resumePayload?: ResumeRunDto | undefined;
}

export interface RunLoopResult {
  readonly runId: string;
  readonly status: AgentRunStatus;
  readonly finalOutput?: string | undefined;
  readonly terminationReason?: TerminationReason | undefined;
  readonly totalSteps: number;
  readonly cumulativeUsage: TokenUsage;
  readonly durationMs: number;
  readonly pendingChallenge?:
    | { readonly type: 'confirmation'; readonly challenge: AgentConfirmationChallenge }
    | { readonly type: 'user_input'; readonly challenge: AgentInputChallenge }
    | undefined;
}

export class ExecuteRunLoopUseCase {
  constructor(
    private readonly runRepository: RunRepositoryPort,
    private readonly inferenceClient: InferenceClientPort,
    private readonly toolsClient: ToolsClientPort,
  ) {}

  public async execute(
    run: AgentRun,
    version: AgentVersion,
    initialGoalInput: string,
    options: ExecuteRunLoopOptions = {},
  ): Promise<RunLoopResult> {
    const startTime = Date.now();
    const signal = options.signal;
    const emit = options.onEvent ?? (() => {});

    // Load active checkpoint if exists
    const latestCheckpoint = await this.runRepository.getLatestCheckpoint(run.runId);

    let currentStepNumber = latestCheckpoint ? latestCheckpoint.stepNumber : 0;
    const scratchpad: Observation[] = latestCheckpoint
      ? [...latestCheckpoint.statePayload.scratchpad]
      : [];
    const decisionSummaries: string[] = latestCheckpoint
      ? [...latestCheckpoint.statePayload.decisionSummaries]
      : [];
    let cumulativeUsage: TokenUsage = latestCheckpoint
      ? { ...latestCheckpoint.statePayload.cumulativeUsage }
      : {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          reasoningTokens: 0,
          cachedTokens: 0,
        };

    let consecutiveErrors = 0;
    let modelCallsCount = 0;
    let toolCallsCount = 0;

    // Handle resume from pending challenge if supplied
    if (options.resumePayload && latestCheckpoint?.pendingChallenge) {
      if (
        options.resumePayload.resumeType === 'user_input' &&
        latestCheckpoint.pendingChallenge.type === 'user_input'
      ) {
        const inputObs: Observation = {
          callId: options.resumePayload.inputId ?? `input_${Date.now()}`,
          toolId: 'system.user_input',
          isSuccess: true,
          output: options.resumePayload.value,
          executionDurationMs: 0,
          recordedAt: new Date().toISOString(),
        };
        scratchpad.push(inputObs);
        decisionSummaries.push(
          `User input provided: ${JSON.stringify(options.resumePayload.value)}`,
        );
        emit({
          event: 'run_resumed',
          data: {
            runId: run.runId,
            stepNumber: currentStepNumber,
            reason: 'user_input_provided',
          },
        });
      }
    }

    try {
      while (true) {
        // 1. Check Cancellation
        if (signal?.aborted) {
          return await this.terminateRun(
            run,
            'cancelled',
            'cancelled_by_user',
            currentStepNumber,
            cumulativeUsage,
            startTime,
            emit,
            undefined,
          );
        }

        // 2. Check Execution Limits & Budgets
        if (currentStepNumber >= run.budget.maxSteps) {
          throw new StepLimitExceededError(run.budget.maxSteps, run.runId);
        }

        if (Date.now() >= run.budget.deadlineMs) {
          throw new DeadlineExceededError(run.runId, run.budget.deadlineMs);
        }

        if (consecutiveErrors >= run.budget.maxConsecutiveErrors) {
          throw new ConsecutiveErrorsExceededError(consecutiveErrors, run.runId);
        }

        if (modelCallsCount >= run.budget.maxModelCalls) {
          throw new BudgetExceededError(
            `Run exceeded maximum allowed model calls (${run.budget.maxModelCalls})`,
            { runId: run.runId, modelCallsCount },
          );
        }

        if (toolCallsCount >= run.budget.maxToolCalls) {
          throw new BudgetExceededError(
            `Run exceeded maximum allowed tool calls (${run.budget.maxToolCalls})`,
            { runId: run.runId, toolCallsCount },
          );
        }

        if (run.budget.maxTokens && cumulativeUsage.totalTokens >= run.budget.maxTokens) {
          throw new BudgetExceededError(
            `Run exceeded maximum token budget of ${run.budget.maxTokens}`,
            { runId: run.runId, cumulativeUsage },
          );
        }

        currentStepNumber += 1;
        const stepStartTime = Date.now();
        const stepId = `step_${run.runId}_${currentStepNumber}` as AgentStepId;

        emit({
          event: 'step_started',
          data: {
            runId: run.runId,
            stepNumber: currentStepNumber,
            type: 'thought',
          },
        });

        // 3. Assemble Working Context Messages
        const messages: ChatMessage[] = this.buildContextMessages(
          version.systemInstructions,
          initialGoalInput,
          scratchpad,
          decisionSummaries,
        );

        // 4. Model Reasoning Call
        const toolsForModel = version.allowedTools.includes('*')
          ? undefined
          : version.allowedTools.filter((t) => !t.startsWith('system.'));

        modelCallsCount += 1;
        const inferenceResponse = await this.inferenceClient.execute(
          {
            requestId: `req_${stepId}`,
            correlationId: run.correlationId,
            canonicalModelId: version.defaultModel,
            messages,
            tools: toolsForModel,
            effort: version.defaultEffort,
            deadlineMs: run.budget.deadlineMs,
            tenantId: run.tenantId,
            actorId: run.actorId,
          },
          signal,
        );

        // Accumulate usage
        cumulativeUsage = this.addUsage(cumulativeUsage, inferenceResponse.usage);

        // Emit normalized thinking events if enabled and present (never raw CoT)
        if (version.policy.privacyPolicy.emitNormalizedThinkingEvents) {
          const thinkingParts = this.extractThinkingParts(inferenceResponse.message);
          for (const chunk of thinkingParts) {
            emit({
              event: 'thought',
              data: {
                runId: run.runId,
                stepNumber: currentStepNumber,
                delta: chunk,
              },
            });
          }
        }

        // Parse tool call if requested by model
        const toolCall = this.extractToolCall(inferenceResponse.message);

        // Case A: Model delivered terminal answer (no tool call)
        if (!toolCall) {
          const finalOutput = this.extractMessageText(inferenceResponse.message);
          const decisionSummary = 'Formulated final goal response.';
          decisionSummaries.push(decisionSummary);

          const step: AgentStep = {
            stepId,
            runId: run.runId,
            stepNumber: currentStepNumber,
            type: 'response',
            status: 'completed',
            decisionSummary,
            stepUsage: inferenceResponse.usage,
            durationMs: Date.now() - stepStartTime,
            startedAt: new Date(stepStartTime).toISOString(),
            completedAt: new Date().toISOString(),
          };

          await this.runRepository.appendStep(step);
          await this.saveCheckpoint(
            run,
            currentStepNumber,
            initialGoalInput,
            scratchpad,
            decisionSummaries,
            cumulativeUsage,
          );

          emit({
            event: 'step_completed',
            data: {
              runId: run.runId,
              stepNumber: currentStepNumber,
              durationMs: step.durationMs,
              stepUsage: step.stepUsage,
            },
          });

          return await this.terminateRun(
            run,
            'completed',
            'goal_achieved',
            currentStepNumber,
            cumulativeUsage,
            startTime,
            emit,
            finalOutput,
          );
        }

        // Case B: Model requested user input
        if (toolCall.name === 'system.request_user_input') {
          const prompt = String(toolCall.arguments.prompt ?? 'User input requested.');
          const challenge: AgentInputChallenge = {
            inputId: `inp_${Date.now()}`,
            runId: run.runId,
            stepNumber: currentStepNumber,
            prompt,
            options: Array.isArray(toolCall.arguments.options)
              ? (toolCall.arguments.options as string[])
              : undefined,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          };

          const step: AgentStep = {
            stepId,
            runId: run.runId,
            stepNumber: currentStepNumber,
            type: 'thought',
            status: 'completed',
            decisionSummary: `Requested user input: "${prompt}"`,
            action: toolCall,
            stepUsage: inferenceResponse.usage,
            durationMs: Date.now() - stepStartTime,
            startedAt: new Date(stepStartTime).toISOString(),
            completedAt: new Date().toISOString(),
          };

          await this.runRepository.appendStep(step);
          await this.saveCheckpoint(
            run,
            currentStepNumber,
            initialGoalInput,
            scratchpad,
            decisionSummaries,
            cumulativeUsage,
            { type: 'user_input', challenge },
          );

          await this.runRepository.updateRunStatus(run.tenantId, run.runId, 'waiting_for_input');

          emit({
            event: 'waiting_for_input',
            data: {
              runId: run.runId,
              inputChallenge: challenge,
            },
          });

          return {
            runId: run.runId,
            status: 'waiting_for_input',
            totalSteps: currentStepNumber,
            cumulativeUsage,
            durationMs: Date.now() - startTime,
            pendingChallenge: { type: 'user_input', challenge },
          };
        }

        // Case C: Standard Tool Call Execution
        // Validate tool against agent policy
        if (!version.allowedTools.includes('*') && !version.allowedTools.includes(toolCall.name)) {
          throw new PolicyViolationError(
            `Tool '${toolCall.name}' is not allowed for agent '${version.agentId}'`,
            { toolName: toolCall.name, allowedTools: version.allowedTools },
          );
        }

        emit({
          event: 'action_requested',
          data: {
            runId: run.runId,
            stepNumber: currentStepNumber,
            toolId: toolCall.name,
            callId: toolCall.id,
            arguments: toolCall.arguments,
          },
        });

        // Determine if confirmation token is needed
        const confirmationToken =
          options.resumePayload?.resumeType === 'confirmation'
            ? options.resumePayload.confirmationToken
            : undefined;

        toolCallsCount += 1;
        const toolOutcome = await this.toolsClient.executeTool(
          {
            toolId: toolCall.name,
            callId: toolCall.id,
            arguments: toolCall.arguments,
            confirmationToken,
            timeoutMs: 30000,
            tenantId: run.tenantId,
            actorId: run.actorId,
            correlationId: run.correlationId,
          },
          signal,
        );

        // Check if tool required confirmation
        if (toolOutcome.status === 'confirmation_required') {
          const step: AgentStep = {
            stepId,
            runId: run.runId,
            stepNumber: currentStepNumber,
            type: 'action',
            status: 'pending',
            decisionSummary: `Awaiting human confirmation for tool '${toolCall.name}'`,
            action: toolCall,
            durationMs: Date.now() - stepStartTime,
            startedAt: new Date(stepStartTime).toISOString(),
          };

          await this.runRepository.appendStep(step);
          await this.saveCheckpoint(
            run,
            currentStepNumber,
            initialGoalInput,
            scratchpad,
            decisionSummaries,
            cumulativeUsage,
            { type: 'confirmation', challenge: toolOutcome.challenge },
          );

          await this.runRepository.updateRunStatus(
            run.tenantId,
            run.runId,
            'waiting_for_confirmation',
          );

          emit({
            event: 'waiting_for_confirmation',
            data: {
              runId: run.runId,
              challengeToken: toolOutcome.challenge.challengeToken,
              confirmationId: toolOutcome.challenge.confirmationId,
              toolId: toolCall.name,
              arguments: toolCall.arguments,
              expiresAt: toolOutcome.challenge.expiresAt,
            },
          });

          return {
            runId: run.runId,
            status: 'waiting_for_confirmation',
            totalSteps: currentStepNumber,
            cumulativeUsage,
            durationMs: Date.now() - startTime,
            pendingChallenge: { type: 'confirmation', challenge: toolOutcome.challenge },
          };
        }

        // Process tool execution result
        const isSuccess = toolOutcome.status === 'success';
        const observation: Observation = {
          callId: toolCall.id,
          toolId: toolCall.name,
          isSuccess,
          output: toolOutcome.status === 'success' ? toolOutcome.output : undefined,
          error: toolOutcome.status === 'failure' ? toolOutcome.error : undefined,
          executionDurationMs: toolOutcome.durationMs,
          recordedAt: new Date().toISOString(),
        };

        scratchpad.push(observation);
        const decisionSummary = isSuccess
          ? `Executed tool '${toolCall.name}' successfully.`
          : `Tool '${toolCall.name}' failed: ${toolOutcome.error.message}`;
        decisionSummaries.push(decisionSummary);

        const step: AgentStep = {
          stepId,
          runId: run.runId,
          stepNumber: currentStepNumber,
          type: 'action',
          status: isSuccess ? 'completed' : 'failed',
          decisionSummary,
          action: toolCall,
          observation,
          stepUsage: inferenceResponse.usage,
          durationMs: Date.now() - stepStartTime,
          startedAt: new Date(stepStartTime).toISOString(),
          completedAt: new Date().toISOString(),
        };

        await this.runRepository.appendStep(step);
        await this.saveCheckpoint(
          run,
          currentStepNumber,
          initialGoalInput,
          scratchpad,
          decisionSummaries,
          cumulativeUsage,
        );

        emit({
          event: 'observation',
          data: {
            runId: run.runId,
            stepNumber: currentStepNumber,
            toolId: toolCall.name,
            callId: toolCall.id,
            isSuccess,
            durationMs: toolOutcome.durationMs,
          },
        });

        emit({
          event: 'step_completed',
          data: {
            runId: run.runId,
            stepNumber: currentStepNumber,
            durationMs: step.durationMs,
            stepUsage: step.stepUsage,
          },
        });

        if (isSuccess) {
          consecutiveErrors = 0;
        } else {
          consecutiveErrors += 1;
        }

        await this.runRepository.updateRunProgress(
          run.tenantId,
          run.runId,
          currentStepNumber,
          cumulativeUsage,
        );
      }
    } catch (err) {
      if (signal?.aborted) {
        return await this.terminateRun(
          run,
          'cancelled',
          'cancelled_by_user',
          currentStepNumber,
          cumulativeUsage,
          startTime,
          emit,
        );
      }

      const terminationReason = this.resolveErrorTerminationReason(err);
      const errorMessage = err instanceof Error ? err.message : String(err);

      return await this.terminateRun(
        run,
        'failed',
        terminationReason,
        currentStepNumber,
        cumulativeUsage,
        startTime,
        emit,
        undefined,
        errorMessage,
      );
    }
  }

  private buildContextMessages(
    systemInstructions: string,
    goal: string,
    scratchpad: readonly Observation[],
    summaries: readonly string[],
  ): ChatMessage[] {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: systemInstructions,
      },
      {
        role: 'user',
        content: `Goal to achieve: ${goal}`,
      },
    ];

    if (summaries.length > 0) {
      const historySummary = summaries.map((s, idx) => `Step ${idx + 1}: ${s}`).join('\n');
      messages.push({
        role: 'assistant',
        content: `Previous step progress:\n${historySummary}`,
      });
    }

    if (scratchpad.length > 0) {
      const recentObservations = scratchpad.slice(-5);
      const obsSummary = recentObservations
        .map(
          (o) =>
            `[Tool: ${o.toolId} (${o.isSuccess ? 'SUCCESS' : 'FAILURE'})]: ${
              o.isSuccess ? JSON.stringify(o.output) : `${o.error?.code}: ${o.error?.message}`
            }`,
        )
        .join('\n\n');

      messages.push({
        role: 'user',
        content: `Recent action observations:\n${obsSummary}\n\nBased on these observations, continue towards the goal or provide the final answer.`,
      });
    }

    return messages;
  }

  private extractToolCall(message: ChatMessage): ToolCall | null {
    if (typeof message.content === 'string') {
      return null;
    }
    const parts = message.content as readonly MessageContentPart[];
    const callPart = parts.find((p) => p.type === 'tool_call') as any;
    if (callPart && callPart.type === 'tool_call') {
      const id = callPart.id ?? callPart.toolCall?.id ?? `call_${Date.now()}`;
      const name = callPart.name ?? callPart.toolCall?.name ?? '';
      const args = callPart.arguments ?? callPart.toolCall?.arguments ?? {};
      return {
        id,
        name,
        arguments: args,
      };
    }
    return null;
  }

  private extractThinkingParts(message: ChatMessage): string[] {
    if (typeof message.content === 'string') {
      return [];
    }
    const parts = message.content as readonly MessageContentPart[];
    return parts
      .filter((p) => p.type === 'thinking')
      .map((p) => (p as { readonly thinking: string }).thinking);
  }

  private extractMessageText(message: ChatMessage): string {
    if (typeof message.content === 'string') {
      return message.content;
    }
    const parts = message.content as readonly MessageContentPart[];
    return parts
      .filter((p) => p.type === 'text')
      .map((p) => (p as { readonly text: string }).text)
      .join('\n');
  }

  private addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
    return {
      promptTokens: a.promptTokens + b.promptTokens,
      completionTokens: a.completionTokens + b.completionTokens,
      totalTokens: a.totalTokens + b.totalTokens,
      reasoningTokens: (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0),
      cachedTokens: (a.cachedTokens ?? 0) + (b.cachedTokens ?? 0),
    };
  }

  private async saveCheckpoint(
    run: AgentRun,
    stepNumber: number,
    goalInput: string,
    scratchpad: readonly Observation[],
    decisionSummaries: readonly string[],
    cumulativeUsage: TokenUsage,
    pendingChallenge?: AgentCheckpoint['pendingChallenge'],
  ): Promise<void> {
    const checkpoint: AgentCheckpoint = {
      checkpointId: `chk_${run.runId}_${stepNumber}`,
      runId: run.runId,
      stepNumber,
      statePayload: {
        goalInput,
        scratchpad,
        decisionSummaries,
        cumulativeUsage,
      },
      pendingChallenge,
      createdAt: new Date().toISOString(),
    };
    await this.runRepository.saveCheckpoint(checkpoint);
  }

  private async terminateRun(
    run: AgentRun,
    status: AgentRunStatus,
    reason: TerminationReason,
    totalSteps: number,
    cumulativeUsage: TokenUsage,
    startTime: number,
    emit: (event: AgentStreamEvent) => void,
    finalOutput?: string,
    errorMessage?: string,
  ): Promise<RunLoopResult> {
    await this.runRepository.updateRunStatus(run.tenantId, run.runId, status, reason, finalOutput);

    const durationMs = Date.now() - startTime;

    if (status === 'completed') {
      emit({
        event: 'run_completed',
        data: {
          runId: run.runId,
          finalOutput,
          totalSteps,
          cumulativeUsage,
          durationMs,
        },
      });
    } else if (status === 'cancelled') {
      emit({
        event: 'run_cancelled',
        data: {
          runId: run.runId,
          reason,
          totalSteps,
          durationMs,
        },
      });
    } else {
      emit({
        event: 'run_failed',
        data: {
          runId: run.runId,
          error: { code: reason, message: errorMessage ?? reason },
          totalSteps,
        },
      });
    }

    return {
      runId: run.runId,
      status,
      finalOutput,
      terminationReason: reason,
      totalSteps,
      cumulativeUsage,
      durationMs,
    };
  }

  private resolveErrorTerminationReason(err: unknown): TerminationReason {
    if (err instanceof StepLimitExceededError) return 'max_steps_exceeded';
    if (err instanceof DeadlineExceededError) return 'deadline_exceeded';
    if (err instanceof ConsecutiveErrorsExceededError) return 'consecutive_errors_exceeded';
    if (err instanceof BudgetExceededError) return 'token_budget_exceeded';
    if (err instanceof PolicyViolationError) return 'policy_violation';
    if (err instanceof InferenceFailureError) return 'fatal_inference_error';
    return 'fatal_tool_error';
  }
}
