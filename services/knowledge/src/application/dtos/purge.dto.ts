export interface TenantPurgeResponseDto {
  readonly tenantId: string;
  readonly collectionsDeleted: number;
  readonly documentsDeleted: number;
  readonly chunksDeleted: number;
  readonly vectorsDeleted: number;
  readonly objectsDeleted: number;
  readonly purgedAt: string;
}
