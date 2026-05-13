import minimist from 'minimist';
import { buildManifest, writeManifest, printManifest } from './schemaManifest.js';
import { generateSchemaHtmlReport } from './htmlReport.js';

const argv = minimist(process.argv.slice(2), {
  string: ['junit', 'session', 'url'],
});

const junitPath = argv['junit'] as string | undefined;
const session = argv['session'] as string | undefined;
const baseUrl = (argv['url'] as string | undefined) ?? '';

if (!junitPath || !session) {
  console.error(`
Usage:
  npm run schema-manifest -- --junit <path-to-junit.xml> --session <session-name> [--url <base-url>]

Example:
  schemathesis run ./captures/nebula/openapi.yaml \\
    --url https://api.example.com --checks all \\
    --report junit --report-junit-path junit.xml

  npm run schema-manifest -- --junit junit.xml --session nebula --url https://api.example.com
`);
  process.exit(1);
}

// Validate junit path exists
import { existsSync } from 'fs';
if (!existsSync(junitPath)) {
  console.error(`Error: JUnit file not found: ${junitPath}`);
  process.exit(1);
}

try {
  const manifest = buildManifest(junitPath, session, baseUrl);
  const manifestPath = writeManifest(manifest, session);
  printManifest(manifest);
  console.log(`  Manifest: ${manifestPath}`);

  import('path').then(({ default: path }) => {
    const outDir = path.dirname(manifestPath);
    generateSchemaHtmlReport(manifest, outDir);
  });
} catch (err) {
  console.error('Error parsing JUnit XML:', err instanceof Error ? err.message : err);
  process.exit(1);
}
