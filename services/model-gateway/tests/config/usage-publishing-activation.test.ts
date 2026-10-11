/**
 * Activation matrix for ENABLE_USAGE_PUBLISHING.
 *
 * Policy: explicit true/false only. Production with an unset flag fails
 * startup; an invalid value fails in every environment; anything else
 * defaults to disabled. All cases use config overrides so no test mutates
 * process.env (the env-parsing branch is covered through overrides of the
 * same resolver shape is NOT needed: parseExplicitSwitch is unit-tested
 * directly below).
 */
import { describe, expect, it } from 'vitest';
import { loadModelGatewayConfig, parseExplicitSwitch } from '../../src/config.js';

describe('usage publishing activation', () => {
  it('parses explicit switches strictly', () => {
    expect(parseExplicitSwitch(undefined, 'FLAG')).toBeUndefined();
    expect(parseExplicitSwitch('true', 'FLAG')).toBe(true);
    expect(parseExplicitSwitch(' TRUE ', 'FLAG')).toBe(true);
    expect(parseExplicitSwitch('false', 'FLAG')).toBe(false);
    expect(parseExplicitSwitch('FALSE', 'FLAG')).toBe(false);
    expect(() => parseExplicitSwitch('yes', 'FLAG')).toThrow(/explicitly 'true' or 'false'/);
    expect(() => parseExplicitSwitch('1', 'FLAG')).toThrow();
    expect(() => parseExplicitSwitch('', 'FLAG')).toThrow();
  });

  it('defaults to disabled outside production', () => {
    for (const environment of ['development', 'staging', 'test'] as const) {
      expect(loadModelGatewayConfig({ environment }).enableUsagePublishing).toBe(false);
    }
  });

  it('fails startup when production has no explicit setting', () => {
    expect(() =>
      loadModelGatewayConfig({ environment: 'production', internalToken: 'test-token' }),
    ).toThrow(/ENABLE_USAGE_PUBLISHING must be explicitly/);
  });

  it('honors explicit false in production (genuinely disabled)', () => {
    const config = loadModelGatewayConfig({
      environment: 'production',
      internalToken: 'test-token',
      enableUsagePublishing: false,
    });
    expect(config.enableUsagePublishing).toBe(false);
  });

  it('honors explicit true and still requires dependencies in production', () => {
    expect(() =>
      loadModelGatewayConfig({
        environment: 'production',
        internalToken: 'test-token',
        enableUsagePublishing: true,
      }),
    ).toThrow(/RABBITMQ_URL/);
    const config = loadModelGatewayConfig({
      environment: 'production',
      internalToken: 'test-token',
      enableUsagePublishing: true,
      rabbitmqUrl: 'amqp://broker:5672',
      outboxDatabase: { database: 'oicunt_ai' },
    });
    expect(config.enableUsagePublishing).toBe(true);
  });

  it('never activates merely because NODE_ENV changes', () => {
    // Overrides carry no flag: resolution depends only on the explicit
    // setting, and production-without-setting throws rather than enabling.
    expect(loadModelGatewayConfig({ environment: 'development' }).enableUsagePublishing).toBe(
      false,
    );
    expect(() =>
      loadModelGatewayConfig({ environment: 'production', internalToken: 'x' }),
    ).toThrow();
  });
});
