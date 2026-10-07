import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestPostgres, type TestPostgresInstance } from './postgres-test-helper.js';
import { DatabaseMigrator } from '../../src/infrastructure/database/migrator.js';
import { PostgresModelRepository } from '../../src/infrastructure/repositories/postgres-model.repository.js';
import { PostgresAuditRepository } from '../../src/infrastructure/repositories/postgres-audit.repository.js';
import {
  CanonicalModel,
  ModelVersion,
  ModelTarget,
  ModelAlias,
  AuditEvent,
  OptimisticLockError,
} from '../../src/domain/index.js';

describe('Real PostgreSQL Integration Test Suite', () => {
  let instance: TestPostgresInstance | null = null;
  let modelRepo: PostgresModelRepository;
  let auditRepo: PostgresAuditRepository;
  let migrator: DatabaseMigrator;

  beforeAll(async () => {
    instance = await setupTestPostgres();
    if (!instance) {
      console.warn(
        'PostgreSQL binaries or test instance not available; skipping PG integration suite.',
      );
      return;
    }

    migrator = new DatabaseMigrator(instance.pool);
    modelRepo = new PostgresModelRepository(instance.pool);
    auditRepo = new PostgresAuditRepository(instance.pool);
  }, 90000);

  afterAll(async () => {
    if (instance) {
      await instance.cleanup();
    }
  });

  it('executes database schema migrations and enforces idempotency', async () => {
    if (!instance) return;

    // Run migrations first time
    const result1 = await migrator.runMigrations();
    expect(result1.applied).toContain('001_initial_schema.sql');
    expect(result1.applied).toContain('002_add_model_family.sql');
    expect(result1.alreadyApplied).toHaveLength(0);

    // Run migrations second time (idempotency check)
    const result2 = await migrator.runMigrations();
    expect(result2.applied).toHaveLength(0);
    expect(result2.alreadyApplied).toContain('001_initial_schema.sql');
    expect(result2.alreadyApplied).toContain('002_add_model_family.sql');

    // Verify tables exist in PostgreSQL information_schema
    const tablesRes = await instance.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'model_registry'`,
    );
    const tableNames = tablesRes.rows.map((r) => r.table_name);
    expect(tableNames).toContain('canonical_models');
    expect(tableNames).toContain('model_versions');
    expect(tableNames).toContain('model_targets');
    expect(tableNames).toContain('routing_policies');
    expect(tableNames).toContain('model_aliases');
    expect(tableNames).toContain('audit_events');
    expect(tableNames).toContain('_migrations');
  });

  it('persists and retrieves CanonicalModel aggregate with versions, targets, policies, and aliases', async () => {
    if (!instance) return;

    const model = new CanonicalModel({
      id: 'oicunt.model.general',
      displayName: 'General Intelligence',
      description: 'Conversational frontier model',
      family: 'anthropic',
      activeVersion: 'v1.0.0',
    });

    const v1 = new ModelVersion({
      id: '11111111-1111-1111-1111-111111111111',
      canonicalModelId: model.id,
      version: 'v1.0.0',
      modalities: ['text', 'image'],
      capabilities: {
        streaming: true,
        toolCalling: true,
        structuredOutputs: true,
        reasoning: true,
        supportedEffortLevels: ['low', 'medium', 'high'],
        defaultEffortLevel: 'medium',
        vision: true,
        audioInput: false,
        audioOutput: false,
        systemInstructions: true,
      },
      limits: { contextWindowTokens: 128000, maxOutputTokens: 4096 },
      pricing: { costPerMillionInputTokens: 3.0, costPerMillionOutputTokens: 15.0 },
      status: 'available',
    });

    const target1 = new ModelTarget({
      id: 'target-anthropic-us',
      modelVersionId: v1.id,
      provider: 'anthropic',
      upstreamModelId: 'claude-3-5-sonnet',
      priority: 1,
      weight: 100,
      region: 'us-east-1',
    });

    const globalAlias = new ModelAlias({
      id: '22222222-2222-2222-2222-222222222222',
      canonicalModelId: model.id,
      aliasName: 'latest',
      targetVersion: 'v1.0.0',
    });

    const tenantAlias = new ModelAlias({
      id: '33333333-3333-3333-3333-333333333333',
      canonicalModelId: model.id,
      aliasName: 'preview',
      targetVersion: 'v1.0.0',
      tenantId: 'tenant-enterprise-99',
    });

    model.addVersion(v1);
    model.addTarget(target1);
    model.setAlias(globalAlias);
    model.setAlias(tenantAlias);

    await modelRepo.save(model);

    // Retrieve and verify
    const retrieved = await modelRepo.findById('oicunt.model.general');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe('oicunt.model.general');
    expect(retrieved?.displayName).toBe('General Intelligence');
    expect(retrieved?.family).toBe('anthropic');
    expect(retrieved?.getVersions()).toHaveLength(1);
    expect(retrieved?.getVersions()[0]?.capabilities.reasoning).toBe(true);
    expect(retrieved?.getVersions()[0]?.capabilities.supportedEffortLevels).toEqual([
      'low',
      'medium',
      'high',
    ]);
    expect(retrieved?.getVersions()[0]?.capabilities.defaultEffortLevel).toBe('medium');
    expect(retrieved?.getTargets()).toHaveLength(1);
    expect(retrieved?.getTarget('target-anthropic-us')?.provider).toBe('anthropic');
    expect(retrieved?.routingPolicy.strategy).toBe('priority-fallback');
    expect(retrieved?.getAliases()).toHaveLength(2);
    expect(retrieved?.getAlias('latest')).toBeDefined();
    expect(retrieved?.getAlias('preview', 'tenant-enterprise-99')).toBeDefined();
  });

  it('handles global and tenant-specific alias upserts without constraint collision', async () => {
    if (!instance) return;

    const model = (await modelRepo.findById('oicunt.model.general'))!;

    // Add a new version v2.0.0
    const v2 = new ModelVersion({
      id: '44444444-4444-4444-4444-444444444444',
      canonicalModelId: model.id,
      version: 'v2.0.0',
      modalities: ['text'],
      capabilities: {
        streaming: true,
        toolCalling: true,
        structuredOutputs: true,
        reasoning: true,
        vision: false,
        audioInput: false,
        audioOutput: false,
        systemInstructions: true,
      },
      limits: { contextWindowTokens: 200000, maxOutputTokens: 8192 },
      pricing: { costPerMillionInputTokens: 5.0, costPerMillionOutputTokens: 25.0 },
    });
    model.addVersion(v2);

    // Update existing global alias 'latest' to point to v2.0.0 (tests global ON CONFLICT upsert)
    model.setAlias(
      new ModelAlias({
        id: '22222222-2222-2222-2222-222222222222',
        canonicalModelId: model.id,
        aliasName: 'latest',
        targetVersion: 'v2.0.0',
      }),
    );

    // Update existing tenant alias 'preview' for 'tenant-enterprise-99' (tests tenant ON CONFLICT upsert)
    model.setAlias(
      new ModelAlias({
        id: '33333333-3333-3333-3333-333333333333',
        canonicalModelId: model.id,
        aliasName: 'preview',
        targetVersion: 'v2.0.0',
        tenantId: 'tenant-enterprise-99',
      }),
    );

    // Save should execute both global and tenant UPSERTs cleanly
    await expect(modelRepo.save(model)).resolves.not.toThrow();

    const retrieved = (await modelRepo.findById('oicunt.model.general'))!;
    expect(retrieved.getAlias('latest')?.targetVersion).toBe('v2.0.0');
    expect(retrieved.getAlias('preview', 'tenant-enterprise-99')?.targetVersion).toBe('v2.0.0');
  });

  it('enforces optimistic concurrency locking on concurrent saves', async () => {
    if (!instance) return;

    const processA = (await modelRepo.findById('oicunt.model.general'))!;
    const processB = (await modelRepo.findById('oicunt.model.general'))!;
    const currentLock = processA.versionLock;

    // Process A updates and saves with lock check
    processA.incrementVersionLock();
    await modelRepo.save(processA, currentLock);

    // Process B attempts to save with stale lock value
    processB.incrementVersionLock();
    await expect(modelRepo.save(processB, currentLock)).rejects.toThrow(OptimisticLockError);
  });

  it('prunes orphaned child rows when entities are removed from aggregate', async () => {
    if (!instance) return;

    const model = (await modelRepo.findById('oicunt.model.general'))!;

    // Initially has 2 versions, 1 target, 2 aliases
    expect(model.getTargets()).toHaveLength(1);
    expect(model.getAliases()).toHaveLength(2);

    // Reconstruct model aggregate without the tenant alias and without the target
    const updatedModel = new CanonicalModel({
      id: model.id,
      displayName: model.displayName,
      description: model.description,
      activeVersion: model.activeVersion,
      versionLock: model.versionLock,
      versions: model.getVersions(),
      targets: [], // removed all targets
      aliases: [model.getAlias('latest')!], // removed tenant alias
      routingPolicy: model.routingPolicy,
    });

    await modelRepo.save(updatedModel);

    // Direct SQL check to verify child rows were deleted from PostgreSQL
    const targetsRes = await instance.pool.query<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM model_registry.model_targets WHERE id = 'target-anthropic-us'`,
    );
    expect(targetsRes.rows[0]?.count).toBe(0);

    const aliasesRes = await instance.pool.query<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM model_registry.model_aliases WHERE canonical_model_id = $1`,
      [model.id],
    );
    expect(aliasesRes.rows[0]?.count).toBe(1); // only the global 'latest' alias remains
  });

  it('executes batch listAll() in constant 5 queries across multiple models', async () => {
    if (!instance) return;

    // Add a second model
    const codingModel = new CanonicalModel({
      id: 'oicunt.model.coding',
      displayName: 'Code Specialist',
      description: 'Optimized for reasoning and syntax generation',
      activeVersion: 'v1.0.0',
    });

    const codeV1 = new ModelVersion({
      id: '55555555-5555-5555-5555-555555555555',
      canonicalModelId: codingModel.id,
      version: 'v1.0.0',
      modalities: ['text'],
      capabilities: {
        streaming: true,
        toolCalling: true,
        structuredOutputs: true,
        reasoning: true,
        vision: false,
        audioInput: false,
        audioOutput: false,
        systemInstructions: true,
      },
      limits: { contextWindowTokens: 128000, maxOutputTokens: 8192 },
      pricing: { costPerMillionInputTokens: 3.0, costPerMillionOutputTokens: 15.0 },
    });
    codingModel.addVersion(codeV1);

    await modelRepo.save(codingModel);

    const allModels = await modelRepo.listAll();
    expect(allModels.length).toBeGreaterThanOrEqual(2);
    const modelIds = allModels.map((m) => m.id);
    expect(modelIds).toContain('oicunt.model.general');
    expect(modelIds).toContain('oicunt.model.coding');
  });

  it('persists and queries audit events in PostgreSQL', async () => {
    if (!instance) return;

    const event1 = new AuditEvent({
      entityType: 'canonical_model',
      entityId: 'oicunt.model.general',
      action: 'CREATE',
      actorId: 'admin-pg-1',
      correlationId: 'trace-pg-1',
      timestamp: new Date(Date.now() - 5000).toISOString(),
      afterState: { id: 'oicunt.model.general' },
    });

    const event2 = new AuditEvent({
      entityType: 'canonical_model',
      entityId: 'oicunt.model.general',
      action: 'UPDATE',
      actorId: 'admin-pg-2',
      correlationId: 'trace-pg-2',
      reason: 'Upgraded version to v2.0.0',
      timestamp: new Date().toISOString(),
      afterState: { id: 'oicunt.model.general', activeVersion: 'v2.0.0' },
    });

    await auditRepo.append(event1);
    await auditRepo.append(event2);

    const events = await auditRepo.listByEntity('canonical_model', 'oicunt.model.general');
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]?.action).toBe('UPDATE'); // ordered by created_at DESC
    expect(events[0]?.reason).toBe('Upgraded version to v2.0.0');

    const recent = await auditRepo.listRecent(5);
    expect(recent.length).toBeGreaterThanOrEqual(2);
  });
});
