# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Resilience, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email **tim.mishiev@gmail.com** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (if any)

You will receive an acknowledgment within 48 hours and a detailed response within 7 days.

## Scope

This policy covers:

- The Resilience application code (backend and frontend)
- Authentication and authorization logic
- Data exposure or leakage
- Injection vulnerabilities (SQL, XSS, command injection)
- Tenant isolation boundary bypasses

## Security Measures

Resilience implements the following security controls:

- **Authentication:** JWT with bcrypt password hashing, per-session revocation via `jti` claims
- **Authorization:** 30 Pundit policies enforcing role-based and tenant-scoped access on every endpoint
- **Tenant isolation:** Organization and area-of-operation boundaries enforced at query scope level
- **Input validation:** Strong parameter filtering on all controller actions
- **Security scanning:** Brakeman static analysis and bundler-audit CVE checking in CI
- **Rate limiting:** Rack::Attack throttling on authentication, SSE token minting, and API endpoints
- **SSE token isolation:** Short-lived 60-second tokens prevent long-lived JWTs from appearing in URLs
- **AI trust boundary:** LLM-generated recommendations are validated against live database records before persistence

## Supported Versions

Only the latest version on the `main` branch is actively maintained.
