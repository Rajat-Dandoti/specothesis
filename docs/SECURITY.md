# Security Considerations

> This document covers security-relevant behaviors, known limitations, and responsible usage guidelines.

---

## What the Tool Captures

Specothesis captures everything your browser sends and receives during a recording session. This includes:

- **Request bodies** — JSON payloads, form fields, file uploads
- **Response bodies** — API responses, potentially including PII or sensitive data
- **Authorization headers** — Bearer tokens, API keys, session tokens
- **Cookies** — stored in Playwright profiles as `storageState`
- **Query string parameters** — including any tokens or identifiers passed in URLs

All of this is written to disk in the session output directory (`captures/<session>/`).

---

## Automatic Secret Redaction

Since v1.1.2, Specothesis redacts sensitive field values in all generated outputs by default (`SCANNER_ENABLE_REDACTION=true`). Any field whose name matches common sensitive patterns — `password`, `token`, `apiKey`, `secret`, `credential`, `otp`, etc. — has its value replaced with `[REDACTED]` in:

- `openapi.yaml` request/response examples
- `stepci-workflow.yaml` request bodies
- `curls/*.sh` command arguments (including JSON bodies)
- Query parameter values

**`raw.har` and `filtered.har` are intentionally never redacted** — they are the source of truth for replay and debugging. Treat them as sensitive files.

To disable redaction (e.g. in a fully sandboxed dev environment):

```bash
SCANNER_ENABLE_REDACTION=false
```

**Do not commit session output directories to version control without reviewing them first, even with redaction enabled** — HAR files, profiles, and response bodies may contain PII or data beyond what key-name matching can catch.

---

## Authorization Header Handling

The StepCI generator (`toStepci.ts`) replaces recognized auth headers with env-var references:
- `Authorization: Bearer <token>` → `${{env.SCANNER_AUTH_TOKEN}}`
- `X-Api-Key: <key>` → `${{env.SCANNER_API_KEY}}`

The OpenAPI generator includes captured values as `example` fields when `SCANNER_ENABLE_EXAMPLES=true`. Since v1.1.2, sensitive field names (tokens, passwords, keys) are redacted to `[REDACTED]` by default. Response body examples may still contain non-key-name-matched sensitive data.

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
- If the app itself patches `window.fetch` before Specothesis's patch runs, the outer patch (Specothesis's) still wraps the original `_fetch` correctly because `addInitScript` runs before the page's JavaScript.
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

1. **Review `raw.har`** — contains complete request and response bodies. Never redacted. Search for tokens, passwords, PII before sharing.
2. **Review `openapi.yaml`** — if `SCANNER_ENABLE_EXAMPLES=true`, example values are redacted by default for known sensitive keys, but response body content (e.g. user data, IDs) may still appear.
3. **Review `stepci-workflow.yaml`** — auth headers are replaced with env-var references; body field values are redacted for sensitive keys.
4. **Review `curls/requests.sh`** — sensitive field values are redacted; verify `Authorization` shows `$SCANNER_AUTH_TOKEN` not a real token.

The `.gitignore` excludes `captures/` and `profiles/` by default. Do not override this without a clear reason.

---

## Reporting Security Issues

If you find a security issue in this tool — particularly anything that could cause credential exposure or session hijacking — please report it responsibly. Do not open a public GitHub issue for security vulnerabilities.

Contact the maintainers directly before public disclosure.
