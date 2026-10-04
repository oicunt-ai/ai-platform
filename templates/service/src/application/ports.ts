import type { AiDomainError } from '../domain/index.js';

export type AiServiceResult<T, E = AiDomainError> =
  { readonly success: true; readonly data: T } | { readonly success: false; readonly error: E };

export function ok<T>(data: T): AiServiceResult<T, never> {
  return { success: true, data };
}

export function err<E>(error: E): AiServiceResult<never, E> {
  return { success: false, error };
}

export interface AiUseCase<TInput, TOutput> {
  execute(input: TInput): Promise<AiServiceResult<TOutput>>;
}
