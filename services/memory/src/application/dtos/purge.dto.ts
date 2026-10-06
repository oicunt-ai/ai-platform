import type { PurgeResult } from '../../domain/index.js';

export interface PurgeRequestDto {
  readonly userId?: string | undefined;
  readonly reason: string;
}

export type PurgeResponseDto = PurgeResult;
