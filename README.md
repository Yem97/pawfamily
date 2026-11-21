# Pawfamily

Website and owner dashboard for **Pawfamily**, a pet rescue and rehoming service. Rescued pets are matched with approved families for an adoption fee.

- **Live site:** deployed automatically to Netlify from `main`
- **Planned domain:** `pawfamilyfreehome.com`
- **Owner dashboard:** `/admin/`

## What it does

**Public website**: Home · Meet our pets (filters by type, sex, age) · individual pet pages with photos, story, health checklist and adoption fee · How to adopt with the online application · Happy tails · About · Ways to help (foster, volunteer, donate, rehoming) · FAQ · Contact · Privacy notice.

**Owner dashboard**: Secure sign-in · overview · add and edit pets with up to 8 photos (resized automatically) · one-click status (available, reserved, adopted, hidden) · adoption applications with stages and private notes · contact messages · adoption stories · site settings (name, contact, fees, announcement bar) · full JSON backup.

Optional email alerts for every application and message (via Resend).

## Project layout

```
site/                  Static website (no build step)
  index.html           Public site shell
  admin/index.html     Owner dashboard shell (noindex)
  assets/              styles.css, ui.js (shared), app.js (public), admin.js (dashboard)
netlify/functions/
  api.mjs              The whole API, one function at /api/*
  lib/                 store (Netlify Blobs), auth, validation, email, http helpers
scripts/
  dev-server.mjs       Local server running the same API on a file store
  hash-password.mjs    Generates the owner's login values for Netlify
tests/
  api.test.mjs         API + security tests (node --test)
  e2e.mjs              Full browser test with Playwright
docs/
  DESIGN.md            Requirements, architecture, API, security, pre-mortem
  SETUP.md             Go-live steps (environment variables, email, domain)
archive/               Earlier demos and proposal (not deployed)
.claude/skills/        Project skills for Claude (see THIRD_PARTY_NOTICES.md)
```

## Go live

See **[docs/SETUP.md](docs/SETUP.md)**. In short: run `npm run hash-password -- "password"`, add `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` and `SESSION_SECRET` in Netlify, and redeploy.

## Develop and test

```bash
npm install
npm run dev          # http://localhost:8888
npm test             # 11 API and security tests
npm run test:e2e     # 15 browser checks (requires Playwright)
```

## Security summary

scrypt-hashed owner password (from env, never in code) · signed `HttpOnly` `SameSite=Strict` session cookie · login lockout after 5 failures · CSRF protection (custom header and Origin check) · server-side validation on every field · honeypot and rate limits on public forms · photo uploads verified by file signature · strict Content-Security-Policy with no inline scripts · all user content escaped. Details in [docs/DESIGN.md](docs/DESIGN.md#4-security-frontend-backend-and-security-perspectives).
