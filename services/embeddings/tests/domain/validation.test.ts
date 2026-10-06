import { describe, it, expect } from 'vitest';
import {
  validateBatchBounds,
  validateInputItems,
  validateModelModality,
  validateRequestedDimensions,
  validateReturnedVectors,
} from '../../src/domain/validation.js';
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
} from '../../src/domain/errors.js';

describe('Embeddings Domain Validation', () => {
  describe('validateBatchBounds', () => {
    it('accepts valid batch count within limits', () => {
      expect(() => validateBatchBounds(['hello'], 256)).not.toThrow();
      expect(() => validateBatchBounds(new Array(100).fill('text'), 256)).not.toThrow();
      expect(() => validateBatchBounds(new Array(256).fill('text'), 256)).not.toThrow();
    });

    it('rejects empty input list with EmptyInputError', () => {
      expect(() => validateBatchBounds([], 256)).toThrow(EmptyInputError);
    });

    it('rejects batch count exceeding maxBatchSize with BatchTooLargeError', () => {
      expect(() => validateBatchBounds(new Array(257).fill('text'), 256)).toThrow(
        BatchTooLargeError,
      );
    });
  });

  describe('validateInputItems', () => {
    it('normalizes valid strings and calculates token estimates', () => {
      const items = validateInputItems(['hello world', '  test sentence  '], 1000);
      expect(items).toHaveLength(2);
      expect(items[0]).toEqual({
        index: 0,
        text: 'hello world',
        characterCount: 11,
        tokenEstimate: 3,
      });
      expect(items[1]).toEqual({
        index: 1,
        text: 'test sentence',
        characterCount: 17,
        tokenEstimate: 5,
      });
    });

    it('rejects non-string item with InvalidRequestError', () => {
      // @ts-expect-error testing invalid type
      expect(() => validateInputItems(['valid', 123], 1000)).toThrow(InvalidRequestError);
    });

    it('rejects empty string with EmptyInputItemError', () => {
      expect(() => validateInputItems(['valid', ''], 1000)).toThrow(EmptyInputItemError);
    });

    it('rejects whitespace-only string with EmptyInputItemError', () => {
      expect(() => validateInputItems(['   '], 1000)).toThrow(EmptyInputItemError);
    });

    it('rejects item exceeding max characters with InputTooLargeError', () => {
      expect(() => validateInputItems(['a'.repeat(101)], 100)).toThrow(InputTooLargeError);
    });
  });

  describe('validateModelModality', () => {
    it('passes when modalities include embedding', () => {
      expect(() =>
        validateModelModality(['text', 'embedding'], 'oicunt.model.embedding'),
      ).not.toThrow();
    });

    it('rejects when modalities do not include embedding with UnsupportedCapabilityError', () => {
      expect(() => validateModelModality(['text'], 'gpt-4o')).toThrow(UnsupportedCapabilityError);
    });
  });

  describe('validateRequestedDimensions', () => {
    it('returns default dimensions when none requested', () => {
      expect(validateRequestedDimensions(undefined, 1536)).toBe(1536);
    });

    it('accepts valid custom dimensions', () => {
      expect(validateRequestedDimensions(512, 1536)).toBe(512);
    });

    it('rejects non-positive or non-integer dimensions with InvalidDimensionsError', () => {
      expect(() => validateRequestedDimensions(-1, 1536)).toThrow(InvalidDimensionsError);
      expect(() => validateRequestedDimensions(0, 1536)).toThrow(InvalidDimensionsError);
      expect(() => validateRequestedDimensions(512.5, 1536)).toThrow(InvalidDimensionsError);
    });

    it('validates against supportedDimensions if specified by model', () => {
      const supported = [512, 1536];
      expect(validateRequestedDimensions(512, 1536, supported)).toBe(512);
      expect(() => validateRequestedDimensions(768, 1536, supported)).toThrow(
        InvalidDimensionsError,
      );
    });
  });

  describe('validateReturnedVectors', () => {
    it('passes when vector count and dimensions match expected contract', () => {
      const vectors = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ];
      expect(() => validateReturnedVectors(vectors, 2, 3)).not.toThrow();
    });

    it('fails with ProviderExecutionFailedError if returned vector count is different', () => {
      const vectors = [[0.1, 0.2, 0.3]];
      expect(() => validateReturnedVectors(vectors, 2, 3)).toThrow(ProviderExecutionFailedError);
    });

    it('fails with DimensionMismatchError if vector dimension is incorrect', () => {
      const vectors = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5], // length 2 instead of 3
      ];
      expect(() => validateReturnedVectors(vectors, 2, 3)).toThrow(DimensionMismatchError);
    });
  });
});
