import { randomUUID } from 'node:crypto';
import type { AuditAction, AuditEntityType } from './types.js';
import { ModelValidationError } from './errors.js';

export interface CreateAuditEventParams {
  readonly auditId?: string | undefined;
  readonly entityType: AuditEntityType;
  readonly entityId: string;
  readonly action: AuditAction;
  readonly actorId: string;
  readonly correlationId: string;
  readonly timestamp?: string | undefined;
  readonly reason?: string | undefined;
  readonly beforeState?: Record<string, unknown> | undefined;
  readonly afterState: Record<string, unknown>;
}

export class AuditEvent {
  public readonly auditId: string;
  public readonly entityType: AuditEntityType;
  public readonly entityId: string;
  public readonly action: AuditAction;
  public readonly actorId: string;
  public readonly correlationId: string;
  public readonly timestamp: string;
  public readonly reason?: string | undefined;
  public readonly beforeState?: Record<string, unknown> | undefined;
  public readonly afterState: Record<string, unknown>;

  constructor(params: CreateAuditEventParams) {
    if (!params.entityId || typeof params.entityId !== 'string' || !params.entityId.trim()) {
      throw new ModelValidationError('AuditEvent entityId cannot be empty', 'entityId');
    }
    if (!params.actorId || typeof params.actorId !== 'string' || !params.actorId.trim()) {
      throw new ModelValidationError('AuditEvent actorId cannot be empty', 'actorId');
    }
    if (
      !params.correlationId ||
      typeof params.correlationId !== 'string' ||
      !params.correlationId.trim()
    ) {
      throw new ModelValidationError('AuditEvent correlationId cannot be empty', 'correlationId');
    }
    if (!params.afterState || typeof params.afterState !== 'object') {
      throw new ModelValidationError('AuditEvent afterState must be an object', 'afterState');
    }

    this.auditId = params.auditId ?? randomUUID();
    this.entityType = params.entityType;
    this.entityId = params.entityId;
    this.action = params.action;
    this.actorId = params.actorId.trim();
    this.correlationId = params.correlationId.trim();
    this.timestamp = params.timestamp ?? new Date().toISOString();
    this.reason = params.reason?.trim() || undefined;
    this.beforeState = params.beforeState
      ? Object.freeze(JSON.parse(JSON.stringify(params.beforeState)))
      : undefined;
    this.afterState = Object.freeze(JSON.parse(JSON.stringify(params.afterState)));
  }

  public toJSON(): {
    readonly auditId: string;
    readonly entityType: AuditEntityType;
    readonly entityId: string;
    readonly action: AuditAction;
    readonly actorId: string;
    readonly correlationId: string;
    readonly timestamp: string;
    readonly reason?: string | undefined;
    readonly beforeState?: Record<string, unknown> | undefined;
    readonly afterState: Record<string, unknown>;
  } {
    return {
      auditId: this.auditId,
      entityType: this.entityType,
      entityId: this.entityId,
      action: this.action,
      actorId: this.actorId,
      correlationId: this.correlationId,
      timestamp: this.timestamp,
      reason: this.reason,
      beforeState: this.beforeState,
      afterState: this.afterState,
    };
  }
}
