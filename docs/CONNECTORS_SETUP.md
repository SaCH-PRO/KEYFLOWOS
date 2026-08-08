# Connecting Your Accounts — Setup Guide

KEYFLOW consumes your business's social and Google accounts in real time and routes everything into KEY (Key Inbox, CRM, marketing, and chat). The pipeline is already live — this guide is the credential setup that turns each channel on.

**Local dev base URL:** `http://localhost:5000` (web) / `http://localhost:3001` (API). In production, replace with your public `APP_URL`.

---

## 1. Google Suite — Drive, Gmail, Forms, Calendar, Contacts

One OAuth flow connects all of them.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a project (e.g. `keyflowos`).
2. **APIs & Services → Library** — enable: **Google Drive API, Gmail API, Google Forms API, Google Calendar API, People API** (contacts).
3. **OAuth consent screen** — External, fill app name + your email. Add scopes: `drive.readonly`, `gmail.readonly`, `forms.responses.readonly`, `calendar.readonly`, `contacts.readonly`.
4. **Credentials → Create OAuth client ID → Web application**:
   - Authorized redirect URI: `http://localhost:3001/connect/google-suite/callback` (prod: `https://YOUR_DOMAIN/connect/google-suite/callback`).
5. Copy into `.env`:
   ```
   GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxx
   GOOGLE_REDIRECT_URI=http://localhost:3001/connect/google-suite/callback
   ```
6. Restart the API, then in the app: **Build → Key Connect → Google Suite → Connect** and approve.

While in testing mode, add your Gmail address as a **test user** on the consent screen.

---

## 2. Meta — Facebook Page, Instagram, Messenger (+ WhatsApp)

One Meta for Developers app powers all four.

1. Go to [developers.facebook.com](https://developers.facebook.com) → **Create App → Business**.
2. Add products: **Messenger** (incl. Instagram settings) and **WhatsApp**.
3. **App Settings → Basic** — copy into `.env`:
   ```
   META_APP_ID=your-app-id
   META_APP_SECRET=your-app-secret
   META_SOCIAL_VERIFY_TOKEN=any-random-string-you-choose
   ```
4. **Webhooks** (in the app dashboard, per product):
   - Messenger → Callback URL: `https://YOUR_PUBLIC_DOMAIN/social/webhook/YOUR_BUSINESS_ID`, Verify token: the same `META_SOCIAL_VERIFY_TOKEN`. Subscribe to `messages`, `messaging_postbacks`.
   - Instagram → same URL, subscribe to `messages`, `comments`, `mentions`.
   - WhatsApp → Callback URL: `https://YOUR_PUBLIC_DOMAIN/whatsapp/webhook/YOUR_BUSINESS_ID`, Verify token: `WHATSAPP_VERIFY_TOKEN`. Subscribe to `messages`.
   > Webhooks require a **public URL** — Meta cannot reach `localhost`. Use a tunnel (`cloudflared tunnel --url http://localhost:3001`) or deploy first.
5. Connect in the app: **Build → Key Connect → Facebook Page / Instagram / Messenger → Connect** and approve the OAuth consent.

### WhatsApp specifics
```
WHATSAPP_ACCESS_TOKEN=<permanent system-user token>
WHATSAPP_PHONE_NUMBER_ID=<from WhatsApp > API Setup>
WHATSAPP_BUSINESS_ACCOUNT_ID=<WABA id>
WHATSAPP_VERIFY_TOKEN=<same random string as step 4>
WHATSAPP_APP_SECRET=<same as META_APP_SECRET>
```
For production, create a **system user** in Meta Business Settings and generate a permanent token with `whatsapp_business_messaging` + `whatsapp_business_management`.

---

## 3. Website / Storefront

No credentials needed. KEYFLOW already crawls your storefront page into the SEO inventory (`sync_seo_pages`) and KEY answers questions from it. Your public booking page lives at `/book/<your-business-slug>`.

---

## 4. What happens after connecting

- **Inbound messages** (WhatsApp, Messenger, Instagram DMs, Gmail) land in **Key Inbox** with AI summaries, intent detection, and urgency scoring — KEY can reply or escalate.
- **Contacts** from every channel resolve into one CRM record (duplicate detection + merge).
- **Drive/Docs** become searchable knowledge for KEY (document intelligence).
- **Forms** responses arrive as intake items.
- **Marketing**: KEY drafts and (with your approval) publishes posts, replies to comments, and runs sequences — see Growth → Social/Campaigns.

## 5. Verification (already proven)

- Simulated Meta WhatsApp + Messenger webhooks → KEY Inbox thread with AI summary + intent (`pricing_question`) — verified 2026-07-23.
- Wrong webhook secret → 401/403 (fail-closed).
- OAuth with missing credentials returns a clear `… not configured` message pointing here.

## 6. Security notes

- Webhooks verify Meta's `X-Hub-Signature-256` (HMAC of the raw body with the app secret) and fail closed when secrets are missing.
- Never commit real app secrets; `.env` stays local. The dev placeholder secrets in `.env` (`*_dev_*`) are for local webhook testing only.
