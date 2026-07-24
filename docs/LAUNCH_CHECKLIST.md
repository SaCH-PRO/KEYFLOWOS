# KEYFLOWOS — Production Launch Checklist

Target: `https://keyflowos.com` on a single VPS, full stack, auto-HTTPS, private-beta posture.

---

## L2 — Provision (you, ~15 min)

1. **Create the VPS**: Ubuntu 24.04, ≥ 4 vCPU / 8 GB RAM / 80 GB disk (Hetzner CX32 or DigitalOcean 8 GB — ~$15–25/mo). Full stack incl. Chatwoot + LiveKit needs the headroom; 4 GB works with Chatwoot profile off.
2. **DNS** at your registrar — A records pointing at the VPS IP:
   - `keyflowos.com` → VPS IP
   - `api.keyflowos.com` → VPS IP
   - `livekit.keyflowos.com` → VPS IP
   - (optional, L1 desk) `chat.keyflowos.com` → VPS IP
3. **SSH in** and run:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/SaCH-PRO/KEYFLOWOS/main/scripts/deploy/setup-vps.sh | bash
   ```
   It installs Docker, clones to `/opt/keyflowos`, generates `.env.production` with random secrets, runs migrations, and boots the stack.

## L3 — Configure secrets

Edit `/opt/keyflowos/.env.production`:

- **Supabase**: same project as dev (or a prod project) — URL, anon key, JWT secret, service-role key. Add production redirect URLs in Supabase → Authentication → URL Configuration: `https://keyflowos.com/auth/callback`.
- **OpenAI**: the valid `AI_INTEGRATIONS_OPENAI_API_KEY`.
- **Google OAuth**: add redirect URI `https://api.keyflowos.com/connect/google-suite/callback` to your Google client (keep the localhost one too). Publish the consent screen (or keep testing + test users for private beta).
- **Meta**: update webhook URLs from the tunnel to `https://api.keyflowos.com/social/webhook/<businessId>` and `https://api.keyflowos.com/whatsapp/webhook/<businessId>`.
- **WhatsApp**: permanent system-user token (Meta Business Settings → System Users), not the 24h temp token.
- **Resend**: verify `keyflowos.com` domain for system email.

Then: `docker compose --env-file .env.production -f docker-compose.production.yml restart api web voice-agent`

## L4 — Verify launch

- [ ] `https://api.keyflowos.com/healthz` → 200
- [ ] `https://keyflowos.com/auth/login` renders (Geist UI)
- [ ] Sign in with owner email; Command Center + mission control load
- [ ] KEY chat answers (OpenAI path works)
- [ ] Voice: mic button in chat connects (wss://livekit.keyflowos.com)
- [ ] Google Suite OAuth completes end-to-end
- [ ] Meta: DM your page → lands in Key Inbox
- [ ] WhatsApp: message the business number → Key Inbox + KEY reply

## L5 — Baseline ops

- **Backups**: nightly `pg_dump` of both databases (script in `scripts/deploy/backup.sh`), weekly MinIO snapshot. Store off-box (S3/Backblaze).
- **Updates**: `git -C /opt/keyflowos pull && docker compose --env-file .env.production -f docker-compose.production.yml up -d --build api web voice-agent`
- **Logs**: `docker compose ... logs -f api` (or `journalctl`-style tail files under /opt/keyflowos/logs).
- **Uptime watch**: point any free monitor (UptimeRobot etc.) at `https://api.keyflowos.com/healthz`.

## Private-beta gates (before open signup)

- [ ] Meta App Review (`pages_messaging`, `whatsapp_business_messaging`, instagram perms) — needs live URL + screen recording
- [ ] Google OAuth consent screen → In production (removes the "unverified app" warning)
- [ ] Supabase email templates (confirm/reset) branded
- [ ] Embedded WhatsApp signup for per-user numbers
- [ ] Invite codes / allowlist on signup (or keep to manual account creation)
