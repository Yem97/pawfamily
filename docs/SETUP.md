# Pawfamily: go-live setup

The site deploys automatically from GitHub to Netlify. These steps switch on the owner login and, optionally, email alerts. Total time: about 10 minutes.

## 1. Create the owner's login values

On any computer with Node.js 20+ and this repository:

```bash
npm install
npm run hash-password -- "the owner's chosen password"
```

It prints three values. The password should be at least 12 characters, and not used anywhere else.

## 2. Add environment variables in Netlify

Netlify → your site → **Site configuration → Environment variables → Add a variable**

| Key | Value | Required |
|---|---|---|
| `ADMIN_EMAIL` | The owner's email (used to sign in) | ✅ |
| `ADMIN_PASSWORD_HASH` | The `scrypt$…` value from step 1 | ✅ |
| `SESSION_SECRET` | The random value from step 1 | ✅ |
| `RESEND_API_KEY` | From resend.com → API Keys (secret) | Optional: email alerts |
| `NOTIFY_EMAIL` | Where alerts go (comma-separate several) | Optional: email alerts |
| `MAIL_FROM` | e.g. `Pawfamily <alerts@pawfamilyrehoming.com>` once the domain is verified in Resend | Optional |

Mark `ADMIN_PASSWORD_HASH`, `SESSION_SECRET` and `RESEND_API_KEY` as **secret**. Never put these values in GitHub or chat.

Then go to **Deploys → Trigger deploy → Deploy site**, because new variables only apply after a fresh deploy.

## 3. First sign-in

1. Open `https://<your-site>/admin/` and sign in.
2. **Settings:** add the business name, licence number, town, public email, phone, default kitten fee and what it includes, default reservation fee, go-home age (weeks), payment info and delivery info. Check the Facebook link.
3. **Parents:** add each mum and dad with a photo.
4. **Litters:** add upcoming litters (mum, dad, expected date) and tick *Published* to show them.
5. **Kittens → Add kitten:** add photos, story, health, mum and dad, kitten fee and reservation fee.
6. Open the public site and check everything looks right.

## 4. Email alerts (optional, recommended)

1. Create a free account at **resend.com**, using the same email you want alerts sent to.
2. Create an API key and add it as `RESEND_API_KEY`. Set `NOTIFY_EMAIL` to that same email.
3. Redeploy. Until a domain is verified in Resend, alerts can only go to the Resend account's own email address, which is fine for owner alerts.
4. After buying `pawfamilyrehoming.com`, verify it in Resend (Domains), then set `MAIL_FROM` to an address at that domain.

Even without email, every enquiry and message is saved in the dashboard.

## 4b. Waiting-list alerts to the public

Alerts to people on the waiting list need emails **from your own domain** (Resend's test sender can only email the account owner):

1. In Resend → **Domains → Add domain** → `pawfamilyrehoming.com`, and add the DNS records it shows (in Netlify DNS if you use it).
2. Once it shows **Verified**, set `MAIL_FROM` in Netlify, e.g. `Pawfamily <hello@pawfamilyrehoming.com>`, and redeploy.
3. From then on, listing a kitten as **Available** emails everyone whose wishes match, once per kitten. Each email has a one-click unsubscribe.

## 4c. Automatic backups

Nothing to set up: Netlify runs `netlify/functions/backup.mjs` on the 1st of every month and keeps the last 12 backups (Dashboard → **Backup**). If email alerts are set up, the owner gets an email each time.

## 5. Custom domain

`pawfamilyrehoming.com` is registered at **Porkbun** and its DNS stays there (so Porkbun's free email forwarding works).

1. Netlify → **Domain management**: `pawfamilyrehoming.com` is the **primary domain**; `www` redirects to it.
2. Porkbun → domain → **DNS**: delete the parking records (`pixie`/`uixie.porkbun.com`), keep the `fwd1`/`fwd2.porkbun.com` MX records, and add:

| Type | Host | Answer |
|---|---|---|
| ALIAS | *(empty)* | `apex-loadbalancer.netlify.com` (or an A record `75.2.60.5`) |
| CNAME | `www` | `pawfamilyfreehome.netlify.app` |

3. Porkbun → **Email Forwarding**: `hello` → the owner's inbox. Put `hello@pawfamilyrehoming.com` in Dashboard → Settings.
4. HTTPS is issued automatically once DNS is verified.

Canonical links, share previews and the sitemap always use `https://pawfamilyrehoming.com` (set in `netlify/functions/lib/site.mjs`; a `SITE_URL` environment variable overrides it). Once the domain shows HTTPS, a redirect rule in `netlify.toml` sends `pawfamilyfreehome.netlify.app` visitors to the main domain.

## Changing the password (owner)

Dashboard → **Settings → Security**: enter a new sign-in email and/or password (12+ characters) and the current password. This signs out every other device. The new password is stored hashed in the site's storage, and nobody else knows it.

## Forgotten password (reset)

Whoever manages the Netlify account: run step 1 with a new temporary password, replace `ADMIN_PASSWORD_HASH` (and `ADMIN_EMAIL` if needed) in Netlify, and redeploy. Replacing the hash **always overrides** the password set in the dashboard, so the owner can sign in with the temporary details and choose a new password in Settings → Security. To sign out every device at once, also replace `SESSION_SECRET`.

## Backups

Dashboard → **Backup → Download backup**, once a month. The file contains buyers' personal details and payment records, so store it privately.

## Local development

```bash
npm install
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD_HASH='scrypt$…' SESSION_SECRET=$(openssl rand -base64 32) npm run dev
# http://localhost:8888  (data saved in .data/, which is git-ignored)
npm test           # 21 API tests
npm run test:e2e   # 28 browser checks (needs Playwright)
```

## Before taking enquiries (UK)

Selling kittens you have bred is a licensable activity in England if you breed 3 or more litters a year or run it as a business (Animal Welfare (Licensing of Activities Involving Animals) Regulations 2018). Kittens must be at least 8 weeks old when they go home, and must be microchipped and registered before then (from June 2024). Check with the local council and put the licence number in **Settings**, so it shows in the footer.
