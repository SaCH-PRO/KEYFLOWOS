# Security Policy — KEYFLOW OS

## Reporting Security Vulnerabilities

If you discover a security vulnerability in KEYFLOW OS, please report it responsibly:

1. **Do NOT open a public issue.**
2. Email: sachingeit@gmail.com (Founder / Security Contact)
3. Include: description, reproduction steps, impact assessment, suggested fix (if any)
4. Response time: Within 48 hours (acknowledgment), 7 days (initial assessment)

## Security Features

### Authentication & Authorization
- Supabase JWT with token validation
- HMAC-JWT admin tokens for super-admin operations
- Dev auth bypass blocked at boot (server refuses to start if enabled)
- httpOnly cookies for session management

### Data Protection
- AES-256 BYOK encryption for user-supplied AI keys
- AES-256 credential encryption for connector credentials
- Tenant-scoped object ACL with `PRIVATE_OBJECT_DIR`
- Multi-tenant isolation via `businessId` throughout
- HMAC-SHA256 tracking pixel signing
- Input sanitization via `sanitize-html`

### AI Safety
- Human-in-the-loop approval for all financial actions (CREATE_INVOICE, UPDATE_CRM, etc.)
- Action approval gate in KeyCortexActionsService
- Autonomous action execution requires explicit user confirmation

## Security Hardening Checklist

- [x] Auth bypass blocked in production
- [x] httpOnly cookies implemented
- [x] Rate limiting (express-rate-limit)
- [x] Helmet security headers
- [x] Input sanitization (sanitize-html)
- [x] Browser key guard (prevents secret key exposure)
- [ ] **GitHub Advanced Security enabled** — see below
- [ ] **CodeQL analysis workflow** — see `.github/workflows/codeql.yml`
- [ ] **Dependabot alerts enabled** — enable in repository settings

## Enabling GitHub Advanced Security (Manual Steps)

The repository owner must complete these steps in the GitHub web UI:

### 1. Enable Secret Scanning
1. Go to **Settings → Security → Secret scanning**
2. Click **Enable GitHub Advanced Security**
3. Enable **Secret scanning → Push protection**
4. Enable **Secret scanning → Custom patterns** (for API keys)

### 2. Enable Code Scanning (CodeQL)
1. Go to **Settings → Security → Code scanning**
2. Click **Set up CodeQL analysis**
3. Select **Default** configuration
4. The workflow file `.github/workflows/codeql.yml` has been prepared

### 3. Enable Dependabot
1. Go to **Settings → Security → Dependabot**
2. Enable **Dependabot alerts**
3. Enable **Dependabot security updates**
4. Review `.github/dependabot.yml` if needed

### 4. Branch Protection
1. Go to **Settings → Branches**
2. Add rule for `main`:
   - Require pull request reviews
   - Require status checks (CI/CD)
   - Require CodeQL scanning
   - Restrict push to CODEOWNERS

## Current Security Posture

| Scan Type | Status | Last Run |
|-----------|--------|----------|
| pnpm audit | Passing (1 high, 2 moderate residual) | CI/CD |
| Trufflehog secret scan | Running (continue-on-error) | CI/CD |
| CodeQL analysis | Not yet configured | — |
| Dependabot alerts | Not enabled | — |
| Secret scanning (push protection) | Not enabled | — |

## Security Audit Log

| Date | Action | Result |
|------|--------|--------|
| 2026-05 | CVE hardening pass | 0 critical, 27/28 high resolved |
| 2026-05 | Uppy removal | Eliminated 28 high CVEs |
| 2026-05 | Auth bypass hardening | Dev auth blocked at boot |
| 2026-05 | Cookie security migration | localStorage → httpOnly |
| 2026-06 | KeyCortex action approval gate | Human-in-the-loop for financial actions |
| 2026-06-25 | CODEOWNERS + SECURITY.md added | Task C — GHAS hardening |
