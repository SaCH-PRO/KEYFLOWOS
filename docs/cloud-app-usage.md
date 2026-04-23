# Cloud App Usage Guide

This guide gives a repeatable way to run the app stack in Cursor Cloud with working public URLs.

## Prerequisites

- Set these secrets in your shell (or export before running):
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`

## Start Everything

Run:

`bash scripts/start-cloud-app.sh`

The script will:

1. Ensure PostgreSQL is installed and running locally.
2. Create a local `keyflow` database/user if needed.
3. Push Prisma schema.
4. Start backend (`apps/server`) in tmux.
5. Start frontend (`apps/web`) in tmux.
6. Start tunnelmole tunnels for both ports.
7. Write `apps/web/.env.local` with current runtime URLs.
8. Print the current public URLs.

## Use the App

After script completion:

- Open the printed `Frontend URL`.
- Sign in using your app account.

## Important Notes

- Tunnel URLs are temporary and can rotate. Re-run the script when they expire.
- The script keeps processes in tmux sessions:
  - `server-dev`
  - `web-dev`
  - `api-tunnel`
  - `web-tunnel`
- To stop all sessions:

`tmux -f /exec-daemon/tmux.portal.conf kill-session -t server-dev`

`tmux -f /exec-daemon/tmux.portal.conf kill-session -t web-dev`

`tmux -f /exec-daemon/tmux.portal.conf kill-session -t api-tunnel`

`tmux -f /exec-daemon/tmux.portal.conf kill-session -t web-tunnel`

