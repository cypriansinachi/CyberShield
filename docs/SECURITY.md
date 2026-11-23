# Security design

## 1. Assets

| Asset | Why it matters |
|---|---|
| Incident records | May describe vulnerabilities, attacks in progress and personal data of customers and staff |
| Evidence files | Screenshots, emails and logs; may contain personal data or malware indicators |
| Audit trail | The basis of accountability and of regulatory and forensic investigations |
| User accounts and sessions | Control access to all of the above |
| Secrets (`DATA_ENCRYPTION_KEY`, `AUDIT_HMAC_KEY`, `SESSION_SECRET`) | Protect evidence confidentiality, audit integrity and session tokens |

## 2. Threat model (STRIDE)

| Threat | Example | Mitigations |
|---|---|---|
| **Spoofing** | Password guessing, credential stuffing, stolen session cookie | scrypt hashing; lockout after 5 failures; per-IP rate limit (stored in the database, so it holds across serverless instances); TOTP MFA (enforceable for privileged roles); HttpOnly + SameSite=Strict + Secure cookie; session tokens stored only as HMACs; idle/absolute timeouts; token rotation at login and after MFA |
| **Tampering** | Altering an incident or deleting an audit entry; modifying evidence | Server-side validation of every state change; append-only audit table (triggers) + HMAC hash chain with verification; AES-GCM authenticated encryption and SHA-256 re-verification of evidence |
| **Repudiation** | "I never closed that incident" | Every action audited with actor, role, IP, user agent, request ID; justification required for overrides, rejections and reopenings; four-eyes closure for major incidents |
| **Information disclosure** | Reporter reads another person's report (IDOR); XSS stealing data; leaked database backup | Object-level authorization in the data access layer (404 for foreign records); internal notes hidden from reporters; strict nonce-based CSP; React escaping; evidence encrypted at rest; minimal data in audit details; `Cache-Control: no-store` on downloads and exports |
| **Denial of service** | Huge uploads, form spam | Body size limit on Server Actions; evidence capped at 4 MB per submission (max 5 files); rate limiting on authentication and registration |
| **Elevation of privilege** | Reporter calls a manager-only Server Action directly | Each Server Action and Route Handler re-authenticates and checks permissions server-side; roles granted only by admins; role changes revoke sessions; admins cannot change their own role |

## 3. OWASP Top 10 (2021) mapping

| OWASP risk | Controls in CyberShield | Code |
|---|---|---|
| A01 Broken Access Control | RBAC + object-level checks, deny-by-default, audited denials, 403/404 pages | `src/lib/rbac.ts`, `src/server/auth/dal.ts`, `src/server/services/incidents.ts` |
| A02 Cryptographic Failures | scrypt, AES-256-GCM, HMAC-SHA256, Secure cookies, HSTS | `src/server/security/crypto.ts` |
| A03 Injection | Drizzle / prepared statements only; Zod validation; LIKE wildcards escaped; CSV formula neutralisation | `src/server/actions/*`, `src/lib/csv.ts` |
| A04 Insecure Design | Explicit state machine, closure gates, four-eyes rule, threat model (this file) | `src/lib/workflow.ts` |
| A05 Security Misconfiguration | Strict CSP, security headers, no `X-Powered-By`, secrets required at start-up, demo accounts behind a flag | `src/proxy.ts`, `next.config.ts` |
| A06 Vulnerable Components | Minimal dependencies; crypto uses only Node built-ins; `npm audit` | `package.json` |
| A07 Identification & Authentication Failures | Lockout, rate limiting, MFA, NIST 800-63B password policy, session management | `src/server/services/auth.ts`, `src/server/auth/session.ts` |
| A08 Software & Data Integrity Failures | Hash-chained audit log; evidence integrity verification | `src/server/audit.ts`, `src/server/services/evidence.ts` |
| A09 Security Logging & Monitoring Failures | Comprehensive audit events, failed-login and denial metrics, SLA escalation, integrity check command | `src/server/audit.ts`, `/compliance`, `npm run audit:verify` |
| A10 Server-Side Request Forgery | The server makes no outbound requests based on user input | n/a |

## 4. Content Security Policy

Set per request in `src/proxy.ts` (production):

```
default-src 'self';
script-src 'self' 'nonce-<random>' 'strict-dynamic';
style-src 'self' 'nonce-<random>';
style-src-attr 'unsafe-inline';
img-src 'self' blob: data:;
font-src 'self'; connect-src 'self';
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';
upgrade-insecure-requests
```

`style-src-attr 'unsafe-inline'` allows inline style *attributes* only (used for chart and progress-bar geometry). Style attributes cannot execute script, and `<style>` elements still require the nonce.

## 5. Evidence pipeline

1. Allow-list by extension (`.png .jpg .jpeg .gif .pdf .txt .log .csv .json .eml`); max 5 files and 4 MB per submission.
2. Content must match the extension (magic bytes for binaries; no NUL bytes in text files).
3. SHA-256 of the original bytes is recorded (chain of custody).
4. Encrypted with AES-256-GCM and stored as ciphertext in the database (`evidence_blobs`) under a random UUID name, in the same transaction as the incident record. Nothing touches the web server's filesystem.
5. Download: session and object-level check → decrypt (GCM authenticates) → SHA-256 re-check → served as `application/octet-stream` attachment with `Content-Security-Policy: default-src 'none'; sandbox` → audit entry. An integrity failure blocks the download and is logged.

## 6. Operational guidance

- Run behind HTTPS; keep `SECURE_COOKIES=true`.
- Enable `REQUIRE_MFA_FOR_PRIVILEGED=true` in production.
- Store `DATA_ENCRYPTION_KEY` and `AUDIT_HMAC_KEY` in a secrets manager and back them up separately from data backups.
- Run `npm run audit:verify` on a schedule and record the head hash externally.
- Review the *Compliance → Access control hygiene* panel (locked, dormant, deactivated accounts) monthly.
