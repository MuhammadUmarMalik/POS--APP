# POS Cloud — Vendor Admin Panel

Your side of the POS system: shops sync their data here, activation requests land
here, and you approve memberships (monthly / yearly / lifetime) from a web UI.

## What it does

- **Activation Requests** — when a shopkeeper uploads a payment screenshot in the
  desktop app, it arrives here with the shop name, phone and payment reference.
  You view the proof, pick a plan, and click **Approve & activate**. The shop
  unlocks automatically the next time it is online (auto-check runs every 10
  minutes, or instantly via its "Check Activation Status" button).
- **Shops** — every shop that has synced or requested activation, with plan,
  status, expiry, last sync, cloud backup download, manual grant/suspend.
- **License Keys** — generate keys from the UI (shown once, only hashes stored),
  see which shop used each key, revoke keys. Keys also validate offline in the
  desktop app via the shared checksum scheme.

## Run it

```bash
cd cloud
npm install
set POS_ADMIN_PASSWORD=choose-a-strong-password   # first boot creates the admin user
npm run build
npm start                                          # http://localhost:8080
```

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `POS_CLOUD_DATA` | `./data` | SQLite database + uploaded payment proofs |
| `POS_ADMIN_USER` | `admin` | Admin username (created on first boot) |
| `POS_ADMIN_PASSWORD` | — | Required on first boot to create the admin |
| `POS_KEY_SECRET` | `POS-DESKTOP-LK1` | License checksum secret — **change it**, must match the desktop build |
| `POS_TOKEN_SECRET` | random per boot | Admin session signing key; set it so logins survive restarts |

Dev mode: `npm run dev` (API) + `npm run dev:admin` (UI with proxy).
Tests: `npm run smoke` — full request → approve → activate contract test.

## Pointing the desktop app at this server

The desktop reads `POS_CLOUD_URL` at startup, e.g. `https://pos.yourdomain.com`.
Set it when packaging the desktop build. Without it, shops run purely offline —
requests queue locally and send once a URL/internet is available.

## Deploying

Any small VPS with Node 20+ works (the DB is a SQLite file in `POS_CLOUD_DATA` —
back that folder up). Put it behind HTTPS (Caddy/nginx or a platform like
Railway/Render). **HTTPS is required in production**: license checks and admin
logins travel over this connection.

## Current limitations (by design, MVP)

- Device endpoints authenticate by `shop_id` only. Fine while shop ids are
  random UUIDs, but add per-shop tokens before exposing sensitive pull data.
- `/api/sync/pull` returns nothing yet — the admin panel doesn't edit shop
  master data, so there is nothing to merge back.
- One admin user. Add rows to the `admins` table (bcrypt hashes) for more.
