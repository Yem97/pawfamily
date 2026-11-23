# Pawfamily: system design

Pawfamily is a pet rescue and rehoming service. Animals are rescued (and some raised), then adopted by approved families for an adoption fee. The brand covers any species. It currently focuses on cats.

Domain (planned): `pawfamilyfreehome.com`. Hosting: Netlify.

---

## 1. Requirements (EARS format)

### Public website
| ID | Requirement |
|---|---|
| P1 | The site shall list every animal whose status is *available* or *reserved*, with photo, name, species, sex, age group and status. |
| P2 | When a visitor filters by species, sex or age group, the site shall show only matching animals and the match count. |
| P3 | The site shall give each animal its own shareable page (`/adopt/<slug>`) with photos, story, health checklist, temperament, and adoption fee. |
| P4 | The site shall show the adoption fee and what it includes wherever an animal is shown, so no visitor mistakes adoption for a free giveaway. |
| P5 | When a visitor submits an adoption application with valid details and consent, the system shall store it, notify the owner by email (if configured) and confirm on screen. |
| P6 | When a visitor submits the contact form with valid details, the system shall store it and notify the owner by email (if configured). |
| P7 | If a form field is invalid, the site shall show a specific message next to that field and shall not submit. |
| P8 | The site shall show "Happy tails" (adoption stories) only when at least one story is published. |
| P9 | The site shall work on phones from 360 px wide with no horizontal scrolling. |
| P10 | The site shall show trust information: meet-before-you-pay, vet checks, home checks, and charity number (if set). |
| P11 | The site shall publish a privacy notice explaining what personal data is collected and why. |

### Owner dashboard (`/admin`)
| ID | Requirement |
|---|---|
| A1 | The dashboard shall be accessible only after signing in with the owner email and password configured in Netlify. |
| A2 | If 5 failed sign-ins occur from one network within 15 minutes, the system shall refuse further attempts for 15 minutes. |
| A3 | The owner shall be able to add, edit, hide and delete animals, including up to 8 photos each. |
| A4 | When the owner changes an animal's status, the public site shall reflect it on the next page load. |
| A5 | The owner shall see adoption applications and move each through: New → Reviewing → Home check → Approved → Adopted / Declined, with private notes. |
| A6 | The owner shall see contact messages and mark them replied. |
| A7 | The owner shall create, edit and publish adoption stories. |
| A8 | The owner shall edit site settings (name, tagline, contact details, social links, default fee, what the fee includes, charity number, announcement bar, about text, donate link). |
| A9 | The owner shall download a full backup (JSON) of all data. |
| A10 | Sessions shall expire after 8 hours, and the owner can sign out at any time. |

### Added features
| ID | Requirement |
|---|---|
| F1 | Pet pages (`/adopt/<slug>`) shall be served with that pet's title, description, photo and canonical URL in the HTML head, so Facebook, WhatsApp and Google show a proper preview. |
| F2 | Visitors shall be able to send a happy tail (story, pet's name, optional photo). It shall not appear publicly until the owner approves it. |
| F3 | Visitors shall be able to join a waiting list with their wishes (type, sex, age). When a matching pet becomes Available, each matching person shall be emailed once, with a one-click unsubscribe that deletes their details. |
| F4 | The system shall count page and pet views anonymously (no cookies, no IP addresses, no identifiers), skip bots and visitors sending Do Not Track or Global Privacy Control, and show 30-day totals to the owner. |
| F5 | `/sitemap.xml` shall list all public pages and listed pets, and `/robots.txt` shall point to it and exclude `/admin/` and `/api/`. |
| F6 | A full backup shall be saved automatically every month, with the last 12 kept and downloadable from the dashboard. |
| F7 | A Donate page shall link to the owner's external donation provider. No payment data is handled by this site. |

---

## 2. Architecture

```
Browser ──► Netlify CDN ──► site/            static HTML, CSS, JS (ES modules, no build step)
        └─► /api/*      ──► netlify/functions/api.mjs   one function, routed internally
                                    │
                                    ├── Netlify Blobs  store "pawfamily"  (records, one key each)
                                    ├── Netlify Blobs  store "pawfamily-images"  (photos)
                                    └── Resend API  (optional email alerts)
```

**Why Netlify Blobs rather than Supabase (for now):** one platform, no extra account, free, and fully testable before launch. Every record is stored under its own key (`animals/<id>`, `applications/<id>`), so two writes never overwrite each other's data. The JSON export (A9) makes moving to Postgres or Supabase later straightforward.

**Local development:** `npm run dev` runs `scripts/dev-server.mjs`, which serves `site/` and runs the same API handler with a filesystem store in `.data/`. The API code is identical in both places. Only the storage adapter differs (`lib/store.mjs`).

---

## 3. API

All responses are JSON: `{ ok: true, ... }` or `{ ok: false, error: "message", fields?: { name: "message" } }`.

### Public
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/public/site` | Public settings, listed animals, published stories |
| POST | `/api/public/applications` | Adoption application (rate limited, honeypot) |
| POST | `/api/public/messages` | Contact message (rate limited, honeypot) |
| GET | `/api/images/<id>` | A photo (immutable, cached for 1 year) |
| GET | `/api/images/<id>/thumb` | ~600 px version for cards (falls back to the full photo) |
| POST | `/api/public/waitlist` | Join the waiting list (rate limited, honeypot, consent) |
| GET | `/api/public/waitlist/unsubscribe?id=&t=` | One-click unsubscribe (token-checked) |
| POST | `/api/public/stories` | Send a happy tail, held for approval (3 per hour per network) |
| POST | `/api/public/hit` | Anonymous page-view count (bots ignored) |

Other functions: `share.mjs` serves `/adopt/<slug>` with per-pet preview tags; `seo.mjs` serves `/sitemap.xml` and `/robots.txt`; `backup.mjs` is a monthly scheduled function.

### Auth
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Sign in (rate limited) and set the session cookie |
| POST | `/api/auth/logout` | Clear the session |
| GET | `/api/auth/me` | Current session state |

### Admin (session cookie plus `X-Requested-With: pawfamily` header required)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/summary` | Counts for the overview |
| GET, POST | `/api/admin/animals` | List all / create |
| PUT, DELETE | `/api/admin/animals/<id>` | Update / delete (deletes photos too) |
| POST | `/api/admin/images` | Upload a photo (data URL, ≤ 3 MB, JPEG/PNG/WebP checked by file signature) |
| DELETE | `/api/admin/images/<id>` | Delete a photo |
| GET | `/api/admin/applications` | List |
| PUT, DELETE | `/api/admin/applications/<id>` | Update status and notes / delete |
| GET | `/api/admin/messages` | List |
| PUT, DELETE | `/api/admin/messages/<id>` | Mark replied / delete |
| GET, POST | `/api/admin/stories` | List / create |
| PUT, DELETE | `/api/admin/stories/<id>` | Update / delete |
| GET, PUT | `/api/admin/settings` | Read / save settings |
| GET | `/api/admin/export` | Full JSON backup |
| GET, DELETE | `/api/admin/waitlist[/<id>]` | Waiting list (tokens never returned) / remove |
| GET | `/api/admin/stats?days=30` | Visit counts, top pages and pets |
| GET, POST | `/api/admin/backups[/<date>]` | List, save now, download a monthly backup |
| GET, PUT | `/api/admin/security` | Change sign-in email and password |

---

## 4. Security (frontend, backend and security perspectives)

| Threat | Control |
|---|---|
| Password guessing | scrypt-hashed password in an env var (never stored in code), constant-time comparison, 5 attempts per 15 min per network |
| Session theft | HMAC-SHA256 signed cookie, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api`, 8-hour expiry |
| CSRF | `SameSite=Strict` cookie, plus a required custom header on admin calls (cross-site requests can't set it without a preflight, which is refused), plus an Origin check |
| XSS | All user content is rendered with `textContent` or escaped. A strict Content-Security-Policy with no inline scripts or styles, and `frame-ancestors 'none'` |
| Malicious uploads | Admin-only, size cap, file-signature check (JPEG/PNG/WebP only), served with `nosniff` and the stored type |
| Spam on public forms | Hidden honeypot field, 5 submissions per hour per network, server-side validation with length limits |
| Data exposure | The public endpoint returns only listed animals and public settings. Applications and messages are admin-only. IPs are stored only as salted hashes for rate limiting |
| Secrets | Read from Netlify environment variables only. `.env` is git-ignored |
| Public photo uploads (happy tails) | Rate limited, size cap, file-signature check, never public until the owner approves |
| Email abuse via the waiting list | Rate limited, consent required, one email per pet per person, unsubscribe token checked; alerts only go out when the owner lists a pet |
| Tracking | Visit counts store only page path and date totals: no cookies, IPs or identifiers. DNT/GPC respected |
| Misconfiguration | If admin env vars are missing, sign-in is refused with a clear "not configured" error (fails closed) |

---

## 5. Pre-mortem: "It's Monday and the launch failed. Why?"

| Failure | Prevention |
|---|---|
| Owner can't sign in because env vars were mistyped | `npm run hash-password` prints exact values to paste. Sign-in shows "not configured" vs "wrong password" distinctly, without revealing which field was wrong |
| Phone photos too big and uploads fail | Photos are resized in the browser to 1600 px JPEG (~300 KB) before upload |
| Site looks empty on launch day | Designed empty states ("New arrivals coming soon"), and the owner adds animals from the dashboard in minutes |
| Visitors think "freehome" means free pets | Fee shown on every card and profile, in the FAQ and the application form (P4) |
| Emails never arrive | Email is optional. Everything also lands in the dashboard. Resend's test sender delivers to the account owner's own address |
| Spam floods the inbox | Honeypot plus rate limit. The owner can delete in bulk later if needed |
| Lost data | Blobs storage is durable. A9 backup export, recommended monthly |
| Scam association with "free home" | Trust block on every page: meet before paying, vet records, home checks, written adoption agreement |
