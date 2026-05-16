/**
 * Shared pipeline — transforms + reports.
 * Called by both the start command and the replay command.
 */

import * as path from 'path';
import type { ScannerConfig } from './config.js';
import type { HarEntry, Har } from './utils/harFilter.js';
import { writeFilteredHar } from './utils/harFilter.js';
import { toOpenApi } from './transform/toOpenApi.js';
import { toStepci } from './transform/toStepci.js';
import { toCurl } from './transform/toCurl.js';
import {
  buildCoverageSummary,
  writeCoverageReport,
  printCoverageTable,
} from './report/coverage.js';
import { detectAnomalies, writeAnomalyReport, printAnomalies } from './report/anomalies.js';
import { detectDrift, loadPreviousCoverage, writeDriftReport, printDrift } from './report/drift.js';
import { generateHtmlReport } from './report/htmlReport.js';

export interface PipelineOptions {
  apiEntries: HarEntry[];
  har: Har;
  sessionName: string;
  runDir: string;
  baseUrl: string;
  config: ScannerConfig;
}

export function runPipeline({ apiEntries, har, sessionName, runDir, baseUrl, config }: PipelineOptions): void {
  const filteredHarPath = path.join(runDir, 'filtered.har');

  const authCfg = {
    authBodyFormat: config.authBodyFormat,
    authUsernameField: config.authUsernameField,
    authPasswordField: config.authPasswordField,
    authTokenPath: config.authTokenPath,
    authScheme: config.authScheme,
  };

  if (config.features.openapi)
    toOpenApi(apiEntries, runDir, config.apiUrl, config.authUrl, config.features.examples, authCfg, {
      title: config.apiTitle,
      version: config.apiVersion,
      description: config.apiDescription,
    }, config.redact);
  if (config.features.stepci) toStepci(apiEntries, sessionName, runDir, config.authUrl, authCfg, config.redact);
  if (config.features.curl) toCurl(apiEntries, runDir, config.redact);

  writeFilteredHar(har, apiEntries, filteredHarPath);

  const needsSummary =
    config.features.coverage ||
    config.features.anomalies ||
    config.features.drift ||
    config.features.htmlReport;
  const coverageSummary = needsSummary ? buildCoverageSummary(apiEntries, sessionName) : null;

  if (config.features.coverage && coverageSummary) {
    writeCoverageReport(coverageSummary, runDir);
    printCoverageTable(coverageSummary);
  }

  const anomalies =
    config.features.anomalies && coverageSummary
      ? detectAnomalies(coverageSummary, apiEntries, {
          publicPatterns: config.publicPatterns,
          slowMs: config.anomalySlowMs,
          largeKb: config.anomalyLargeKb,
          repeatedN: config.anomalyRepeatedN,
        })
      : [];
  if (config.features.anomalies && coverageSummary) {
    writeAnomalyReport(anomalies, runDir);
    printAnomalies(anomalies);
  }

  let driftReport = null;
  if (config.features.drift && coverageSummary) {
    const previousCoverage = loadPreviousCoverage(runDir);
    if (previousCoverage) {
      driftReport = detectDrift(coverageSummary, previousCoverage);
      writeDriftReport(driftReport, runDir);
      printDrift(driftReport);
    }
  }

  if (config.features.htmlReport && coverageSummary) {
    generateHtmlReport(coverageSummary, anomalies, driftReport, runDir);
  }

  const relDir = path.relative(process.cwd(), runDir);
  console.log(`\nDone. Outputs in:\n  ${relDir}\n`);
  console.log('Next steps:');
  console.log(`  schemathesis run ${relDir}/openapi.yaml --url ${baseUrl} --checks all`);
  console.log(`  stepci run ${relDir}/stepci-workflow.yaml`);
}
