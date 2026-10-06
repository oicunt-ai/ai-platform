import type { ResumeType } from '../../domain/types.js';

export interface ResumeRunDto {
  readonly resumeType: ResumeType;
  /** Cryptographic Ed25519 confirmation token if resuming from waiting_for_confirmation */
  readonly confirmationToken?: string | undefined;
  /** Challenge identifier if resuming from waiting_for_input */
  readonly inputId?: string | undefined;
  /** Submitted value if resuming from waiting_for_input */
  readonly value?: unknown | undefined;
}
