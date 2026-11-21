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
| `MAIL_FROM` | e.g. `Pawfamily <alerts@pawfamilyfreehome.com>` once the domain is verified in Resend | Optional |

Mark `ADMIN_PASSWORD_HASH`, `SESSION_SECRET` and `RESEND_API_KEY` as **secret**. Never put these values in GitHub or chat.

Then go to **Deploys → Trigger deploy → Deploy site**, because new variables only apply after a fresh deploy.

## 3. First sign-in

1. Open `https://<your-site>/admin/` and sign in.
2. **Settings:** add the town, public email, phone, default adoption fee and what it includes. Check the Facebook link.
3. **Pets → Add a pet:** add photos, story, health and fee.
4. Open the public site and check everything looks right.

## 4. Email alerts (optional, recommended)

1. Create a free account at **resend.com**, using the same email you want alerts sent to.
2. Create an API key and add it as `RESEND_API_KEY`. Set `NOTIFY_EMAIL` to that same email.
3. Redeploy. Until a domain is verified in Resend, alerts can only go to the Resend account's own email address, which is fine for owner alerts.
4. After buying `pawfamilyfreehome.com`, verify it in Resend (Domains), then set `MAIL_FROM` to an address at that domain.

Even without email, every application and message is saved in the dashboard.

## 5. Custom domain

Once `pawfamilyfreehome.com` is bought: Netlify → **Domain management → Add a domain**, and follow the DNS instructions. HTTPS is issued automatically and free.

## Changing the password

Run step 1 again with the new password, replace `ADMIN_PASSWORD_HASH` in Netlify, and redeploy. To sign out every device at once, also replace `SESSION_SECRET`.

## Backups

Dashboard → **Backup → Download backup**, once a month. The file contains adopters' personal details, so store it privately.

## Local development

```bash
npm install
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD_HASH='scrypt$…' SESSION_SECRET=$(openssl rand -base64 32) npm run dev
# http://localhost:8888  (data saved in .data/, which is git-ignored)
npm test           # API tests
npm run test:e2e   # browser tests (needs Playwright)
```
