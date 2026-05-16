/**
 * Shared regex for identifying dynamic ID segments in URL paths.
 * Matches:
 *   - plain integers                (e.g. 42, 12345)
 *   - UUID v4                       (e.g. 550e8400-e29b-41d4-a716-446655440000)
 *   - 24-character MongoDB ObjectId (e.g. 507f1f77bcf86cd799439011)
 */
export const ID_SEGMENT =
  /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24})$/i;
