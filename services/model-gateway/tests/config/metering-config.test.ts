/**
 * Regression tests for explicit metering activation.
 *
 * Publishing must be deployment-controlled: no environment implies it, in
 * particular not NODE_ENV=production. All cases use config overrides so no
 * test mutates process.env.
 */
import { describe, expect, it } from 'vitest';
import { loadModelGatewayConfig } from '../../src/config.js';

describe('metering activation is explicit', () => {
  it('fails startup in production without the explicit flag (no implicit activation)', () => {
    expect(() =>
      loadModelGatewayConfig({
        environment: 'production',
        internalToken: 'test-token',
      }),
    ).toThrow(/ENABLE_USAGE_PUBLISHING must be explicitly/);
  });

  it('stays disabled by default in development', () => {
    const config = loadModelGatewayConfig({ environment: 'development' });
    expect(config.enableUsagePublishing).toBe(false);
  });

  it('enables only with the explicit flag', () => {
    const config = loadModelGatewayConfig({
      environment: 'development',
      enableUsagePublishing: true,
    });
    expect(config.enableUsagePublishing).toBe(true);
  });

  it('requires broker and outbox settings in production when enabled', () => {
    expect(() =>
      loadModelGatewayConfig({
        environment: 'production',
        internalToken: 'test-token',
        enableUsagePublishing: true,
      }),
    ).toThrow(/RABBITMQ_URL/);
  });

  it('passes production validation when enabled with complete settings', () => {
    const config = loadModelGatewayConfig({
      environment: 'production',
      internalToken: 'test-token',
      enableUsagePublishing: true,
      rabbitmqUrl: 'amqp://broker:5672',
      outboxDatabase: { database: 'oicunt_ai' },
    });
    expect(config.enableUsagePublishing).toBe(true);
  });

  it('prefers OUTBOX_DB_* over DATABASE_* with the oicunt_ai default', () => {
    const config = loadModelGatewayConfig({
      outboxDatabase: { host: 'outbox.db.internal' },
    });
    expect(config.outboxDatabase.host).toBe('outbox.db.internal');
    expect(config.outboxDatabase.database).toBe('oicunt_ai');
    expect(config.meteringCaptureTimeoutMs).toBe(2000);
  });
});
