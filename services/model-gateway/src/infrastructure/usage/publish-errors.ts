/**
 * Delivery outcome errors for metering publication.
 *
 * The drainer distinguishes them: retryable failures reschedule the row
 * with backoff (identity preserved), while an unroutable event is
 * quarantined immediately — retrying a message the broker cannot route
 * would burn all attempts without ever succeeding.
 */

/** The broker outcome is unknown: retry with the ORIGINAL event identity. */
export class UsagePublishError extends Error {
  public readonly eventId: string;
  public readonly retryable = true as const;

  constructor(eventId: string, message: string) {
    super(`Usage publication failed for event ${eventId}: ${message}`);
    this.name = 'UsagePublishError';
    this.eventId = eventId;
  }
}

/**
 * The broker positively refused to route the message (basic.return under
 * mandatory publishing). Retrying cannot succeed: quarantine immediately
 * with the original identity intact for operator inspection and replay.
 */
export class UsageUnroutableError extends Error {
  public readonly eventId: string;
  public readonly retryable = false as const;

  constructor(eventId: string, replyText: string) {
    super(`Usage event ${eventId} was returned unroutable by the broker: ${replyText}`);
    this.name = 'UsageUnroutableError';
    this.eventId = eventId;
  }
}
