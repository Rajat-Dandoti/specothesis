import type { ScannerFeatures } from './config.js';

// ---------------------------------------------------------------------------
// --only flag resolution
// ---------------------------------------------------------------------------

export const VALID_ONLY_VALUES = [
  'openapi',
  'stepci',
  'curl',
  'coverage',
  'anomalies',
  'drift',
  'html',
] as const;

export type OnlyValue = (typeof VALID_ONLY_VALUES)[number];

/**
 * Parse a comma-separated --only string and return a new ScannerFeatures object
 * with only the requested outputs enabled, plus their implied dependencies:
 *   anomalies → coverage
 *   drift     → coverage
 *   html      → coverage + anomalies + drift
 *
 * The non-output flags (dedup, examples, redact) are preserved from baseFeatures.
 * Throws an Error with a list of valid values when any unknown value is supplied.
 */
export function resolveOnlyFlag(onlyStr: string, baseFeatures: ScannerFeatures): ScannerFeatures {
  const requested = onlyStr
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as OnlyValue[];

  const invalid = requested.filter((v) => !(VALID_ONLY_VALUES as readonly string[]).includes(v));
  if (invalid.length > 0) {
    throw new Error(
      `Unknown --only value(s): ${invalid.join(', ')}. Valid values: ${VALID_ONLY_VALUES.join(', ')}`
    );
  }

  // Start with all output flags off; preserve non-output flags
  const features: ScannerFeatures = {
    dedup: baseFeatures.dedup,
    examples: baseFeatures.examples,
    redact: baseFeatures.redact,
    openapi: false,
    stepci: false,
    curl: false,
    coverage: false,
    anomalies: false,
    drift: false,
    htmlReport: false,
  };

  for (const v of requested) {
    if (v === 'openapi') features.openapi = true;
    if (v === 'stepci') features.stepci = true;
    if (v === 'curl') features.curl = true;
    if (v === 'coverage') features.coverage = true;
    if (v === 'anomalies') {
      features.anomalies = true;
      features.coverage = true;
    }
    if (v === 'drift') {
      features.drift = true;
      features.coverage = true;
    }
    if (v === 'html') {
      features.htmlReport = true;
      features.coverage = true;
      features.anomalies = true;
      features.drift = true;
    }
  }

  return features;
}
