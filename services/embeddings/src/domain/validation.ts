import type { EmbeddingInputItem } from './types.js';
import {
  BatchTooLargeError,
  DimensionMismatchError,
  EmptyInputError,
  EmptyInputItemError,
  InputTooLargeError,
  InvalidDimensionsError,
  InvalidRequestError,
  ProviderExecutionFailedError,
  UnsupportedCapabilityError,
} from './errors.js';

export function validateBatchBounds(
  inputs: unknown,
  maxBatchSize: number,
): asserts inputs is readonly string[] {
  if (!Array.isArray(inputs)) {
    throw new InvalidRequestError('The inputs field must be an array of strings');
  }

  if (inputs.length === 0) {
    throw new EmptyInputError();
  }

  if (inputs.length > maxBatchSize) {
    throw new BatchTooLargeError(inputs.length, maxBatchSize);
  }
}

export function validateInputItems(
  inputs: readonly string[],
  maxCharactersPerItem: number,
): readonly EmbeddingInputItem[] {
  const items: EmbeddingInputItem[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const text = inputs[i];

    if (typeof text !== 'string') {
      throw new InvalidRequestError(`Input item at index ${i} must be a string`);
    }

    if (text.trim().length === 0) {
      throw new EmptyInputItemError(i);
    }

    if (text.length > maxCharactersPerItem) {
      throw new InputTooLargeError(
        `Input item at index ${i} exceeds maximum permitted length of ${maxCharactersPerItem} characters (actual: ${text.length})`,
      );
    }

    items.push({
      index: i,
      text: text.trim(),
      characterCount: text.length,
      tokenEstimate: Math.max(1, Math.ceil(text.length / 4)),
    });
  }

  return items;
}

export function validateModelModality(modalities: readonly string[], modelId: string): void {
  if (!modalities.includes('embedding')) {
    throw new UnsupportedCapabilityError(modelId, 'embedding');
  }
}

export function validateRequestedDimensions(
  requestedDimensions: number | undefined,
  defaultDimensions: number,
  supportedDimensions?: readonly number[] | undefined,
): number {
  if (requestedDimensions === undefined) {
    return defaultDimensions;
  }

  if (
    typeof requestedDimensions !== 'number' ||
    !Number.isInteger(requestedDimensions) ||
    requestedDimensions <= 0
  ) {
    throw new InvalidDimensionsError(
      `Requested dimensions must be a positive integer (received: ${String(requestedDimensions)})`,
    );
  }

  if (supportedDimensions && supportedDimensions.length > 0) {
    if (!supportedDimensions.includes(requestedDimensions)) {
      throw new InvalidDimensionsError(
        `Requested dimensions (${requestedDimensions}) not supported by model. Permitted dimensions: [${supportedDimensions.join(', ')}]`,
      );
    }
  }

  return requestedDimensions;
}

export function validateReturnedVectors(
  vectors: readonly (readonly number[])[],
  expectedCount: number,
  expectedDimensions: number,
): void {
  if (vectors.length !== expectedCount) {
    throw new ProviderExecutionFailedError(
      `Downstream execution returned ${vectors.length} vectors, expected ${expectedCount} for input batch`,
    );
  }

  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    if (!v || !Array.isArray(v) || v.length !== expectedDimensions) {
      throw new DimensionMismatchError(expectedDimensions, v?.length ?? 0, i);
    }
  }
}
