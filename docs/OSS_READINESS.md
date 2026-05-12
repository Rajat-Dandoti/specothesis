# Open Source Readiness Checklist

> What needs to happen before this ships publicly. Ordered by how much it blocks someone from using the tool.

---

## Blocking — Do Before Publishing

### 1. Add a LICENSE

No license = legally "all rights reserved" in most countries. No serious open-source user will adopt an unlicensed tool.

**Recommendation:** MIT License. It's permissive, standard for developer tooling, and requires zero friction from users embedding the tool in their workflows.

Create `/LICENSE` with the MIT text and your name/year. Done.

### 2. Write a README.md

This is the product homepage. Someone who lands on the GitHub repo has 30 seconds to decide if this is worth trying. Right now they see an `ARCHITECTURE.md` with XML diagrams — not encouraging.

**Minimum sections:**
- What it is (2 sentences)
- Why it exists (the problem it solves)
- Quick install
- 5-minute quickstart (login, capture, view outputs)
- Full CLI reference
- Output file descriptions (what's in `openapi.yaml`, `stepci-workflow.yaml`, `report.html`)
- Comparison with similar tools (optional but builds trust)

### 3. Add `bin` to `package.json` + shebang for `npx` / global install

Right now the tool only works if you clone the repo. For open source, the primary distribution path should be:

```sh
npx specothesis start --url https://example.com
# or
npm install -g specothesis
specothesis start --url https://example.com
```

This requires:
- `"bin": { "specothesis": "./dist/capture.js" }` in `package.json`
- `#!/usr/bin/env node` as the first line of the compiled `dist/capture.js`
- A `prepare` npm script that runs `tsc` before publish: `"prepare": "tsc"`

### 4. Add `engines` field

Declare the required Node.js version. The code uses `Node16` module resolution and `ES2022` — it requires Node 18 or newer.

```json
"engines": { "node": ">=18.0.0" }
```

### 5. Add `.npmignore` or configure `files` in `package.json`

Without this, `npm publish` will ship the entire repo including `.claude/`, `.hypothesis/`, `captures/`, `profiles/`, `ARCHITECTURE.md`, `docs/`, etc. Only the compiled output and necessary files should be published.

```json
"files": [
  "dist/",
  "README.md",
  "LICENSE",
  ".env.example"
]
```

### 6. Fix the `--data-urlencode` bug before publishing

The curl generator produces incorrect commands for `application/x-www-form-urlencoded` bodies. See `FINDINGS.md` for the fix. Users copy-pasting curl commands that silently produce wrong results is a bad first impression.

---

## High Priority — Do Soon After

### 7. Add `operationId` to OpenAPI spec output

This is required by code generators (`openapi-generator-cli`, FastAPI, etc.) and most OpenAPI validators raise a warning without it. Auto-generating from method + path is trivial.

### 8. Add `tags` to OpenAPI spec output

A spec with 30+ operations and no tags is unusable in Swagger UI — everything appears in one flat "Default" group. Auto-tagging from the first meaningful path segment (after `/api/v1/`) takes ~10 lines.

### 9. Write a proper `CONTRIBUTING.md`

For contributors, this is as important as the README. Should cover:
- Development setup (clone, install, build, run)
- How to run a test capture
- Code style guide (TypeScript strict, no comments for obvious things)
- How to add a new anomaly rule
- How to add a new output format
- PR conventions

### 10. Add a `CHANGELOG.md`

At minimum, document the v1 → v2 additions (coverage, anomaly detection, drift, HTML report, schemathesis manifest). Future maintainers and users need to track what changed between versions.

### 11. Add GitHub Actions CI workflow

Basic workflow that runs `tsc --noEmit` on push. This prevents broken TypeScript from landing on main.

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx tsc --noEmit
```

### 12. Add example outputs to the repo

A `examples/` directory with sample output files (sanitized, no real credentials) lets users understand what they're getting before running anything:

```
examples/
  simple-api/
    openapi.yaml
    stepci-workflow.yaml
    coverage.json
    report.html        (open in browser to see what it looks like)
    curls/requests.sh
```

---

## Medium Priority — Good to Have

### 13. Add `--version` flag

One of the most basic CLI conventions. Users troubleshooting need to know what version they're on.

```ts
if (argv.version || argv.v) {
  const { createRequire } = await import('module');
  const pkg = createRequire(import.meta.url)('../../package.json');
  console.log(pkg.version);
  process.exit(0);
}
```

### 14. Publish Playwright as `peerDependency` instead of `dependency`

Playwright is large (~200MB with browsers). Many users may already have it installed. Consider making it a `peerDependency` so users who already have Playwright don't install a second copy.

Document the required version range.

### 15. Add `--quiet` / `--verbose` flags

The current output logs every request as it happens. Fine for interactive use, noisy in CI. A `--quiet` flag that suppresses per-request logging and only prints the final summary would make the tool friendlier in automated pipelines.

### 16. Add `.github/ISSUE_TEMPLATE` and `PULL_REQUEST_TEMPLATE`

Reduces triage burden on maintainers. Simple templates for bug reports (OS, Node version, command used, expected vs actual behavior) and feature requests.

### 17. Enable security policy

Add `SECURITY.md` explaining how to report vulnerabilities responsibly (not via public issues). GitHub has a built-in "Security" tab for this.

### 18. Add repository metadata to `package.json`

```json
"repository": {
  "type": "git",
  "url": "https://github.com/<your-org>/specothesis"
},
"keywords": ["api", "openapi", "playwright", "har", "testing", "stepci", "schemathesis"],
"homepage": "https://github.com/<your-org>/specothesis#readme",
"bugs": { "url": "https://github.com/<your-org>/specothesis/issues" }
```

This makes the package discoverable on npm and links directly to GitHub from the npm page.

---

## Lower Priority — After v1 Release

### 19. Set up a test suite

The `.hypothesis/` directory suggests property-based tests were explored at some point. Actual test coverage should cover:
- `globToRegex` — unit tests for glob matching
- `normalisePath` / `normaliseCoveragePath` — path parameterization edge cases
- `parseMultipartText` — multipart parsing with various boundary formats
- `deduplicateEntries` — dedup logic
- `detectDrift` / `detectAnomalies` — with fixture data

### 20. Consider a `--dry-run` mode

Show what would be captured / processed without writing any files. Useful for testing configs.

### 21. Add a Docker image

Many QA engineers don't have Node/npm installed but do have Docker. A lightweight image would expand the audience significantly.

```dockerfile
FROM node:20-slim
RUN npx -y playwright install chromium --with-deps
WORKDIR /app
COPY package*.json .
RUN npm ci
COPY . .
RUN npm run build
ENTRYPOINT ["node", "dist/capture.js"]
```

### 22. Add HAR replay mode

Let users point the tool at an existing HAR file (from Chrome DevTools export, Postman, mitmproxy) and run only the processing pipeline. This removes the Playwright dependency for users who already have HAR files and dramatically expands the tool's use cases.

```sh
specothesis replay --har path/to/export.har --session my-session
```
