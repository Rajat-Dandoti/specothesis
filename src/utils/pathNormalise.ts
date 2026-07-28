/**
 * Shared regex for identifying dynamic ID segments in URL paths.
 * Matches:
 *   - plain integers                (e.g. 42, 12345)
 *   - UUID v4                       (e.g. 550e8400-e29b-41d4-a716-446655440000)
 *   - 24-character MongoDB ObjectId (e.g. 507f1f77bcf86cd799439011)
 *   - ULID                          (e.g. 01ARZ3NDEKTSV4RRFFQ69G5FAV — 26 chars Crockford base32)
 *   - NanoID / base64url            (e.g. V1StGXR8_Z5jdHi6B-myT — 21 chars)
 *   - any ≥20-char alphanumeric+dash/underscore segment (catch-all for CUID, Snowflake, Firebase UID, etc.)
 */
export const ID_SEGMENT =
  /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24}|[0-7][0-9A-HJKMNP-TV-Z]{25}|[A-Za-z0-9_-]{21}|[A-Za-z0-9_-]{20,})$/;
