# Security Considerations

> This document covers security-relevant behaviors, known limitations, and responsible usage guidelines.

---

## What the Tool Captures

API Scanner captures everything your browser sends and receives during a recording session. This includes:

- **Request bodies** — JSON payloads, form fields, file uploads
- **Response bodies** — API responses, potentially including PII or sensitive data
- **Authorization headers** — Bearer tokens, API keys, session tokens
- **Cookies** — stored in Playwright profiles as `storageState`
- **Query string parameters** — including any tokens or identifiers passed in URLs

All of this is written to disk in the session output directory (`captures/<session>/`).

---

## What Does NOT Get Scrubbed Automatically

The tool does **not** automatically redact secrets from outputs. This means:

- `openapi.yaml` with `includeExamples=true` will contain real request/response values from your session
- `stepci-workflow.yaml` will contain real header values unless replaced by env-var references
- `curls/*.sh` will contain real `Authorization` header values if they don't use `$SCANNER_AUTH_TOKEN`
- `coverage.json`, `anomalies.json`, `drift.json` contain path and header metadata but not body content
- `raw.har` and `filtered.har` contain **full** request and response bodies including any secrets

**Do not commit session output directories to version control without reviewing them first.**

---

## Authorization Header Handling

The StepCI generator (`toStepci.ts`) replaces recognized auth headers with env-var references:
- `Authorization: Bearer <token>` → `${{env.SCANNER_AUTH_TOKEN}}`
- `X-Api-Key: <key>` → `${{env.SCANNER_API_KEY}}`

The OpenAPI generator includes actual captured values as `example` fields when `SCANNER_ENABLE_EXAMPLES=true`. These examples will contain real tokens.

The cURL generator currently only handles `Authorization` → `$SCANNER_AUTH_TOKEN`. Other auth headers (custom schemes, `X-Session-Token`, etc.) are written with their captured value.

---

## Profile Storage

Playwright profiles (`profiles/<name>.json`) contain full browser `storageState`:
- Session cookies for any domain visited during login
- `localStorage` and `sessionStorage` contents

These are equivalent to a stolen session. Treat them with the same care as passwords:
- Never commit them to git (`.gitignore` excludes `profiles/` by default)
- Store them with appropriate filesystem permissions
- Rotate them when the underlying session expires or the account password changes

---

## The FormData JavaScript Injection

The tool injects a script into every page in the browser context that monkey-patches `window.fetch` and `XMLHttpRequest.send`. This is necessary to capture multipart request bodies that Chrome's CDP doesn't expose.

**Implications:**
- The injected script runs in the page's JavaScript context. A page with strict CSP (`script-src 'self'`) may block or report the injection. The injection still works because it runs via `context.addInitScript` at the browser/CDP level, which bypasses content-level CSP, but browser console warnings may appear.
- The script accesses `FormData.forEach()`, which reveals field names and values (but not file contents — only file names and MIME types).
- If the app itself patches `window.fetch` before API Scanner's patch runs, the outer patch (API Scanner's) still wraps the original `_fetch` correctly because `addInitScript` runs before the page's JavaScript.
- The injection writes to `window.__apiScannerFd`. If the target app already uses this global name, there will be a conflict. The injection guards against re-injection (`if (window.__apiScannerFd !== undefined) return;`) but cannot handle a pre-existing global with this name.

---

## Responsible Usage

This tool is designed for:
- Capturing API traffic from applications you own or have explicit permission to test
- QA and API documentation workflows on your own test/staging environments
- Security testing in authorized pentesting engagements

**Do not use this tool to:**
- Capture API traffic from third-party applications without authorization
- Intercept traffic from other users or systems
- Bypass authentication on systems you don't own

The tool operates entirely in your local browser session — it does not intercept other users' traffic. However, the captured HAR files may contain data from live environments. Use staging environments when possible.

---

## Sensitive Data in Outputs

Before sharing or publishing any session outputs:

1. **Review `raw.har`** — contains complete request and response bodies. Search for tokens, passwords, PII.
2. **Review `openapi.yaml`** — if `SCANNER_ENABLE_EXAMPLES=true`, example values come from real captured data.
3. **Review `stepci-workflow.yaml`** — check that auth headers show `${{env.SCANNER_AUTH_TOKEN}}` and not real token values.
4. **Review `curls/requests.sh`** — check for hardcoded bearer tokens.

The `.gitignore` excludes `captures/` and `profiles/` by default. Do not override this without a clear reason.

---

## Reporting Security Issues

If you find a security issue in this tool — particularly anything that could cause credential exposure or session hijacking — please report it responsibly. Do not open a public GitHub issue for security vulnerabilities.

Contact the maintainers directly before public disclosure.
