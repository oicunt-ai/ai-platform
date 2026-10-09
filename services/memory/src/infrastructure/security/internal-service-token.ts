import {
  verifyInternalServiceToken as verifySharedToken,
  type InternalServiceTokenClaims,
} from '@oicunt-ai/internal-contracts';

export type InternalClaims = InternalServiceTokenClaims;

export function verifyInternalServiceToken(
  token: string,
  secret: string,
  audience: string,
): InternalClaims | null {
  const result = verifySharedToken(token, { secret, expectedAudience: audience });
  return result.success ? result.claims : null;
}
