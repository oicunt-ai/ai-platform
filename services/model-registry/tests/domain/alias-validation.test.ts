import { describe, expect, it } from 'vitest';
import {
  CanonicalModel,
  ModelVersion,
  ModelAlias,
  AliasCycleDetectedError,
  ModelValidationError,
  VersionNotFoundError,
} from '../../src/domain/index.js';

describe('ModelAlias Domain Validation and Cycle Detection', () => {
  const setupModel = () => {
    const model = new CanonicalModel({
      id: 'oicunt.model.general',
      displayName: 'General Intelligence',
      description: 'Desc',
      activeVersion: 'v1.0.0',
    });

    const v1 = new ModelVersion({
      canonicalModelId: model.id,
      version: 'v1.0.0',
      modalities: ['text'],
      capabilities: {
        streaming: true,
        toolCalling: true,
        structuredOutputs: true,
        reasoning: false,
        vision: false,
        audioInput: false,
        audioOutput: false,
        systemInstructions: true,
      },
      limits: { contextWindowTokens: 128000, maxOutputTokens: 4096 },
      pricing: { costPerMillionInputTokens: 3.0, costPerMillionOutputTokens: 15.0 },
    });

    const v2 = new ModelVersion({
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

    model.addVersion(v1);
    model.addVersion(v2);

    return { model, v1, v2 };
  };

  it('resolves direct alias to target version', () => {
    const { model } = setupModel();
    model.setAlias(
      new ModelAlias({
        canonicalModelId: model.id,
        aliasName: 'latest',
        targetVersion: 'v2.0.0',
      }),
    );

    const resolved = model.resolveVersion('latest');
    expect(resolved.version).toBe('v2.0.0');
  });

  it('resolves chained aliases', () => {
    const { model } = setupModel();
    model.setAlias(
      new ModelAlias({
        canonicalModelId: model.id,
        aliasName: 'preview',
        targetVersion: 'v2.0.0',
      }),
    );
    model.setAlias(
      new ModelAlias({
        canonicalModelId: model.id,
        aliasName: 'fast',
        targetVersion: 'preview',
      }),
    );

    const resolved = model.resolveVersion('fast');
    expect(resolved.version).toBe('v2.0.0');
  });

  it('rejects self-referencing alias on creation', () => {
    expect(
      () =>
        new ModelAlias({
          canonicalModelId: 'oicunt.model.general',
          aliasName: 'latest',
          targetVersion: 'latest',
        }),
    ).toThrowError(ModelValidationError);
  });

  it('detects circular alias loops on setting alias and on resolution', () => {
    const { model } = setupModel();
    model.setAlias(
      new ModelAlias({
        canonicalModelId: model.id,
        aliasName: 'alias-a',
        targetVersion: 'alias-b',
      }),
    );

    // Setting alias-b to point back to alias-a creates a cycle
    expect(() =>
      model.setAlias(
        new ModelAlias({
          canonicalModelId: model.id,
          aliasName: 'alias-b',
          targetVersion: 'alias-a',
        }),
      ),
    ).toThrowError(AliasCycleDetectedError);
  });

  it('prioritizes tenant-specific alias override over global alias', () => {
    const { model } = setupModel();
    // Global alias points to v1
    model.setAlias(
      new ModelAlias({
        canonicalModelId: model.id,
        aliasName: 'default',
        targetVersion: 'v1.0.0',
      }),
    );
    // Tenant override points to v2
    model.setAlias(
      new ModelAlias({
        canonicalModelId: model.id,
        aliasName: 'default',
        targetVersion: 'v2.0.0',
        tenantId: 'tenant-enterprise-1',
      }),
    );

    const globalResolution = model.resolveVersion('default');
    expect(globalResolution.version).toBe('v1.0.0');

    const tenantResolution = model.resolveVersion('default', 'tenant-enterprise-1');
    expect(tenantResolution.version).toBe('v2.0.0');

    const otherTenantResolution = model.resolveVersion('default', 'tenant-other');
    expect(otherTenantResolution.version).toBe('v1.0.0');
  });

  it('throws VersionNotFoundError when alias target does not exist', () => {
    const { model } = setupModel();
    model.setAlias(
      new ModelAlias({
        canonicalModelId: model.id,
        aliasName: 'broken',
        targetVersion: 'v9.9.9',
      }),
    );

    expect(() => model.resolveVersion('broken')).toThrowError(VersionNotFoundError);
  });
});
