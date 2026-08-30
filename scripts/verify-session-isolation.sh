#!/usr/bin/env bash
# Two brand-new users, two brand-new businesses, ONE session name.
#
# Before the fix this was measured against the running stack: the second user's
# message landed in the first user's row, the first user's conversation was
# destroyed, and the second user's onboarding chat came back empty forever.
#
# Signup is rate limited to 5/hour/IP in Postgres, so the counter is cleared
# first — a 429 here is that limit, not a broken auth path.
set -uo pipefail
API=http://127.0.0.1:3001
PW='Correct-Horse-Battery-9!'
cd /c/Users/sachd/Downloads/KEYFLOWOS
unset DATABASE_URL DIRECT_URL REDIS_URL SUPABASE_URL 2>/dev/null || true
J() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);
  const g=(o,p)=>p.split(".").reduce((a,k)=>a&&a[k],o);process.stdout.write(String(g(j,process.argv[1])??""))}catch{}})' "$1"; }

echo "DELETE FROM auth_rate_limits WHERE bucket LIKE 'signup:%';" \
  | npx prisma db execute --schema packages/db/prisma/schema.prisma --stdin >/dev/null 2>&1

make_user() { # $1 label -> "TOKEN BIZID"
  local stamp email body token bs biz
  stamp=$(date +%s%N); email="iso$1-$stamp@keyflow.test"
  body=$(curl -s --max-time 40 -X POST "$API/identity/signup" -H 'Content-Type: application/json' \
    -H 'Origin: http://127.0.0.1:5000' -d "{\"email\":\"$email\",\"password\":\"$PW\",\"firstName\":\"Iso\",\"lastName\":\"$1\"}")
  token=""
  for k in accessToken session.access_token access_token; do
    token=$(printf '%s' "$body" | J "$k"); [ -n "$token" ] && break
  done
  [ -n "$token" ] || { echo "SIGNUP_FAILED $(printf '%s' "$body" | head -c 200)" >&2; return 1; }
  bs=$(curl -s --max-time 40 -X POST "$API/identity/bootstrap" -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$email\",\"firstName\":\"Iso\",\"lastName\":\"$1\"}")
  biz=$(printf '%s' "$bs" | J 'business.id')
  [ -n "$biz" ] || { echo "BOOTSTRAP_FAILED" >&2; return 1; }
  echo "$token $biz"
}

say_it() { # token biz message
  curl -s -o /dev/null --max-time 180 -X POST "$API/ai/businesses/$2/flow/chat" \
    -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
    -d "{\"message\":$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$3"),\"sessionId\":\"onboarding\",\"history\":[]}"
}

read -r TOK_A BIZ_A < <(make_user A) || exit 1
read -r TOK_B BIZ_B < <(make_user B) || exit 1
echo "user A business: $BIZ_A"
echo "user B business: $BIZ_B"

MSG_A="My business is a bakery called Rise and Crumb."
MSG_B="My business is a garage called Ace Motors."
echo; echo "A sends its onboarding message, then B sends its own, same session name."
say_it "$TOK_A" "$BIZ_A" "$MSG_A"
say_it "$TOK_B" "$BIZ_B" "$MSG_B"

show() { # label token biz needle
  local out
  out=$(curl -s --max-time 40 -H "Authorization: Bearer $2" "$API/ai/businesses/$3/flow/sessions")
  printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const label=process.argv[1], needle=process.argv[2];
    let a=[]; try{a=JSON.parse(s)}catch{}
    const sess=a.find(x=>x.id==="onboarding");
    if(!sess){console.log(`  ${label}: NO onboarding session returned  <-- the conversation was lost`);return}
    const txt=JSON.stringify(sess.messages||[]);
    console.log(`  ${label}: sessions=${a.length} id="${sess.id}" messages=${(sess.messages||[]).length} ownMessagePresent=${txt.includes(needle)}`);
  })' "$1" "$4"
}
echo; echo "Each user reads back their own onboarding session:"
show "user A" "$TOK_A" "$BIZ_A" "Rise and Crumb"
show "user B" "$TOK_B" "$BIZ_B" "Ace Motors"

echo; echo "Neither can see the other (expect ownMessagePresent=false):"
show "A looking for B's text" "$TOK_A" "$BIZ_A" "Ace Motors"
show "B looking for A's text" "$TOK_B" "$BIZ_B" "Rise and Crumb"

echo; echo "Rows in the database keyed on the fixed name 'onboarding':"
docker exec keyflowos-db-1 psql -U keyflow -d keyflow -t -c \
  "SELECT id, business_id FROM flow_sessions WHERE id LIKE '%onboarding' ORDER BY updated_at DESC LIMIT 5;" 2>/dev/null | grep -v '^\s*$' | sed 's/^/  /'
