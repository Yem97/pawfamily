# Pawfamily

Website and owner dashboard for **Pawfamily**, a home breeder of kittens. Kittens are raised and litter-trained at home, then reserved or bought for a kitten fee and delivered personally by the breeder with all ownership documents.

- **Live site:** deployed automatically to Netlify from `main`
- **Planned domain:** `pawfamilyfreehome.com`
- **Owner dashboard:** `/admin/`

## What it does

**Public website**: Home · Our kittens (filters by sex and age) · individual kitten pages with photos, story, parents, health checklist, kitten fee, refundable reservation fee and ready date · Upcoming litters (with "Reserve from this litter") · Meet the parents · How it works with the enquiry form · Happy tails · About · FAQ · Contact · Privacy notice.

**On phones**: kittens appear right after a short headline, as swipeable cards · bottom tab bar (Home, Pets, Enquire, Contact) · 2 kittens per row with a sticky filter bar · swipeable photo gallery and a sticky "Kitten fee · reservation £X · Enquire" bar on each kitten · 3-step enquiry form · dismissible announcement · small thumbnails for fast loading on mobile data. The dashboard gets bottom navigation and a floating "+ Add kitten" button. Desktop layout is unchanged.

**Owner dashboard**: Secure sign-in · overview · add and edit kittens with up to 8 photos (resized automatically), mum and dad, kitten fee and reservation fee · one-click status (available, reserved, gone home, hidden) · enquiries with the buyer's answers (reserve or buy, male or female, experience, children, delivery area), stages New → Chatting → Reserved → Paid in full → Delivered / Declined, agreed fee, deposit, balance, payment and delivery dates, documents checklist and private notes · parents · litters · contact messages · happy tails · site settings (business name, licence number, fees, go-home age, payment and delivery info, announcement bar) · full JSON backup.

**Also**: Facebook/WhatsApp previews with each kitten's photo · "Share your happy tail" (moderated) · waiting list with automatic new-kitten emails · anonymous visitor stats (no cookies) · sitemap and robots for Google · automatic monthly backups.

Optional email alerts for every enquiry and message (via Resend).

## Project layout

```
site/                  Static website (no build step)
  index.html           Public site shell
  admin/index.html     Owner dashboard shell (noindex)
  assets/              styles.css, ui.js (shared), app.js (public), admin.js (dashboard)
netlify/functions/
  api.mjs              The whole API, one function at /api/*
  share.mjs            Kitten pages with Facebook/Google preview tags (/adopt/<kitten>)
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
npm test             # 21 API, security and feature tests
npm run test:e2e     # 28 browser checks incl. 4 phone sizes (requires Playwright)
```

## Security summary

scrypt-hashed owner password (from env, never in code) · signed `HttpOnly` `SameSite=Strict` session cookie · login lockout after 5 failures · CSRF protection (custom header and Origin check) · server-side validation on every field · honeypot and rate limits on public forms · photo uploads verified by file signature · strict Content-Security-Policy with no inline scripts · all user content escaped. Details in [docs/DESIGN.md](docs/DESIGN.md#4-security-frontend-backend-and-security-perspectives).
