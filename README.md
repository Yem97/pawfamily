# Pawfamily

Website and owner dashboard for **Pawfamily**, a pet rescue and rehoming service. Rescued pets are matched with approved families for an adoption fee.

- **Live site:** deployed automatically to Netlify from `main`
- **Planned domain:** `pawfamilyfreehome.com`
- **Owner dashboard:** `/admin/`

## What it does

**Public website**: Home · Meet our pets (filters by type, sex, age) · individual pet pages with photos, story, health checklist and adoption fee · How to adopt with the online application · Happy tails · About · Ways to help (foster, volunteer, donate, rehoming) · FAQ · Contact · Privacy notice.

**On phones**: pets appear right after a short headline, as swipeable cards · bottom tab bar (Home, Pets, Apply, Contact) · 2 pets per row with a sticky filter bar · swipeable photo gallery and a sticky "£fee · Apply to adopt" bar on each pet · 3-step application form · dismissible announcement · small thumbnails for fast loading on mobile data. The dashboard gets bottom navigation and a floating "+ Add pet" button. Desktop layout is unchanged.

**Owner dashboard**: Secure sign-in · overview · add and edit pets with up to 8 photos (resized automatically) · one-click status (available, reserved, adopted, hidden) · adoption applications with stages and private notes · contact messages · adoption stories · site settings (name, contact, fees, announcement bar) · full JSON backup.

**Also**: Facebook/WhatsApp previews with each pet's photo · "Share your happy tail" (moderated) · waiting list with automatic new-pet emails · anonymous visitor stats (no cookies) · sitemap and robots for Google · automatic monthly backups · Donate page linked to the owner's provider.

Optional email alerts for every application and message (via Resend).

## Project layout

```
site/                  Static website (no build step)
  index.html           Public site shell
  admin/index.html     Owner dashboard shell (noindex)
  assets/              styles.css, ui.js (shared), app.js (public), admin.js (dashboard)
netlify/functions/
  api.mjs              The whole API, one function at /api/*
  share.mjs            Pet pages with Facebook/Google preview tags (/adopt/<pet>)
  seo.mjs              /sitemap.xml and /robots.txt
  backup.mjs           Monthly scheduled backup
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
npm test             # 20 API, security and feature tests
npm run test:e2e     # 27 browser checks incl. 4 phone sizes (requires Playwright)
```

## Security summary

scrypt-hashed owner password (from env, never in code) · signed `HttpOnly` `SameSite=Strict` session cookie · login lockout after 5 failures · CSRF protection (custom header and Origin check) · server-side validation on every field · honeypot and rate limits on public forms · photo uploads verified by file signature · strict Content-Security-Policy with no inline scripts · all user content escaped. Details in [docs/DESIGN.md](docs/DESIGN.md#4-security-frontend-backend-and-security-perspectives).
