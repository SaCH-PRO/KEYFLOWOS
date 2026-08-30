#!/usr/bin/env bash
# Live proof that a Redis outage no longer logs everybody out.
#
# Run against a stack that is already up:  bash scripts/verify-redis-degradation.sh
# It STOPS AND STARTS the redis container, and creates two real accounts
# (redisprobe-*@keyflow.test). Do not point it at anything but local.
#
# Expected, and measured on 2026-08-30:
#
#   Redis up    signup -> bootstrap 201 -> /identity/me 200
#   Redis down  the same token         -> /identity/me 200   (401 before the fix)
#   Redis down  a brand-new account    -> bootstrap  201     (401 before the fix)
#   Redis up    logout                 -> /identity/me 401   (revocation still bites)
#
# That last line is the one that matters most. Degrading on a Redis FAILURE
# must not weaken the check when Redis can actually answer; if it ever returns
# 200, the fix traded away a real control and belongs reverted.
#
# Two things this probe got wrong first, both worth not repeating:
#
#  - It called /identity/me without bootstrapping and read the 404 as failure.
#    404 means the handler RAN and found no local row, which only happens after
#    the middleware attached the user. 401 is the signal that matters.
#  - Signup is rate limited to 5/hour/IP (Postgres, not Redis), so re-running
#    this returns 429 and looks exactly like a broken auth path. Clear it with:
#      echo "DELETE FROM auth_rate_limits WHERE bucket LIKE 'signup:%';" #        | npx prisma db execute --schema packages/db/prisma/schema.prisma --stdin

API=http://127.0.0.1:3001
PW='Correct-Horse-Battery-9!'
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@"; }
tok() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);
  process.stdout.write(j.session?.access_token||j.access_token||j.accessToken||j.data?.session?.access_token||"")}catch{}})'; }

signup_raw() {
  curl -s --max-time 30 -X POST "$API/identity/signup" \
    -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:5000' \
    -d "{\"email\":\"$1\",\"password\":\"$PW\",\"firstName\":\"Redis\",\"lastName\":\"Probe\"}"
}
bootstrap() {  # $1 token, $2 email
  curl -s -o /dev/null -w '%{http_code}' --max-time 30 -X POST "$API/identity/bootstrap" \
    -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$2\",\"firstName\":\"Redis\",\"lastName\":\"Probe\"}"
}

STAMP=$(date +%s)
E1="redisprobe-$STAMP@keyflow.test"
say "1. baseline — Redis UP: signup, bootstrap, then read yourself"
TOK=$(signup_raw "$E1" | tok)
[ -n "$TOK" ] || { echo "   signup returned no token"; exit 1; }
echo "   signup token          : yes"
echo "   POST /identity/bootstrap -> $(bootstrap "$TOK" "$E1")"
echo "   GET  /identity/me        -> $(code -H "Authorization: Bearer $TOK" "$API/identity/me")   (expect 200)"

say "2. stop Redis"
docker stop keyflowos-redis-1 >/dev/null 2>&1 && echo "   stopped"; sleep 3

say "3. THE FIX — the same still-valid token, Redis down"
echo "   GET  /identity/me        -> $(code -H "Authorization: Bearer $TOK" "$API/identity/me")   (401 before the fix; expect 200)"

say "4. a brand-new account, created and bootstrapped entirely while Redis is down"
E2="redisprobe2-$STAMP@keyflow.test"
BODY=$(signup_raw "$E2"); TOK2=$(printf '%s' "$BODY" | tok)
if [ -n "$TOK2" ]; then
  echo "   signup token          : yes"
  echo "   POST /identity/bootstrap -> $(bootstrap "$TOK2" "$E2")   (401 before the fix)"
  echo "   GET  /identity/me        -> $(code -H "Authorization: Bearer $TOK2" "$API/identity/me")"
else
  echo "   signup issued NO token. Full response, so this is not guessed at:"
  printf '   %s\n' "$(printf '%s' "$BODY" | head -c 500)"
fi

say "5. restart Redis"
docker start keyflowos-redis-1 >/dev/null 2>&1
for _ in $(seq 1 25); do docker exec keyflowos-redis-1 redis-cli ping 2>/dev/null | grep -q PONG && break; sleep 1; done
echo "   ping: $(docker exec keyflowos-redis-1 redis-cli ping 2>/dev/null | tr -d '\r')"

say "6. NEGATIVE CONTROL — revocation must still bite when Redis answers"
echo "   GET  /identity/me        -> $(code -H "Authorization: Bearer $TOK" "$API/identity/me")   (expect 200)"
echo "   POST /identity/logout    -> $(code -X POST -H "Authorization: Bearer $TOK" "$API/identity/logout")"
sleep 2
echo "   GET  /identity/me        -> $(code -H "Authorization: Bearer $TOK" "$API/identity/me")   (expect 401; a 200 here means the fix gave away a real control)"
