# Pet Store · Deland Junction

Website work for a Ragdoll cattery client.

## What's in this repository

| Folder | What it is | Status |
|---|---|---|
| `ragdoll-site/` | **The cattery website.** 10 pages (home, kittens, kitten profiles, litters and waiting list, our cats, about, news, FAQ, contact) plus an owner dashboard. One file: `cattery-website.html`. | Latest. Demo data is saved in the visitor's browser. |
| `ragdoll-proposal/` | Interactive proposal: website preview, owner dashboard demo, options, timeline and approval message. `ragdoll-proposal.html` is the standalone file to send to clients. | Sent to client for review |
| `pet-store/` | First prototype: a general pet supplies shop with cart and checkout. | Early concept, kept for reference |
| `reference/` | `chatgpt-dynamic-website.html`, the original concept the cattery site was based on. | Reference only |

## Opening the files

Each site is a single HTML file. Double-click it to open it in a browser. The cattery website needs an internet connection for its photos and fonts.

**Owner dashboard demo login:** `owner@cattery-demo.com` / `ragdoll123` (link in the website footer).

## Next step: the real hosted system

The plan for turning `ragdoll-site/` into a live system:

- **Hosting:** Netlify (free), deployed automatically from this repository on every push (settings in `netlify.toml`)
- **Database, secure login and photo storage:** Supabase (free tier)
- **Enquiry and waiting-list email alerts:** Resend (free tier)

**Before going public,** replace all placeholders (`[CATTERY NAME]`, `[Town]`, contact details) and remove the sample kittens, reviews and health results.

## Live addresses (once deployed on Netlify)

| Address | Shows |
|---|---|
| `/` | The cattery website |
| `/proposal` | The interactive proposal |
| `/pet-store` | The first pet store prototype |
