#!/usr/bin/env bash
# Provision the Chatwoot L1 desk for KEYFLOWOS (idempotent):
#   - admin user (admin@keyflow.local / KeyflowDev2026!)
#   - "KEYFLOWOS" account
#   - "KEY Desk" API-channel inbox
#   - "KEY" agent bot whose webhook points at our API server
# Prints the env values to copy into .env (CHATWOOT_*).
#
# Usage: bash scripts/chatwoot-setup.sh
# Prereq: docker compose up -d chatwoot chatwoot-worker
#         docker compose run --rm chatwoot bundle exec rails db:chatwoot_prepare
set -euo pipefail
cd "$(dirname "$0")/.."

WEBHOOK_SECRET="${CHATWOOT_WEBHOOK_SECRET:-keyflow-chatwoot-webhook-dev}"
API_PUBLIC_URL="${CHATWOOT_API_PUBLIC_URL:-http://host.docker.internal:3001}"

docker compose exec -T chatwoot bundle exec rails runner - <<RUBY
email = 'admin@keyflow.local'
password = 'KeyflowDev2026!'

user = User.find_by(email: email)
unless user
  user = User.create!(email: email, password: password, password_confirmation: password, name: 'KEYFLOW Admin', confirmed_at: Time.current)
end

account = Account.first || Account.create!(name: 'KEYFLOWOS')
AccountUser.find_or_create_by!(account: account, user: user) { |au| au.role = :administrator }

inbox = account.inboxes.find_by(name: 'KEY Desk')
unless inbox
  channel = Channel::Api.create!(account: account)
  inbox = Inbox.create!(account: account, name: 'KEY Desk', channel: channel)
end

bot_url = "${API_PUBLIC_URL}/chatwoot/webhook/${WEBHOOK_SECRET}"
bot = AgentBot.find_by(name: 'KEY')
if bot
  bot.update!(outgoing_url: bot_url)
else
  bot = AgentBot.create!(name: 'KEY', description: 'KEY — AI front-line support agent', outgoing_url: bot_url)
end

AgentBotInbox.find_or_create_by!(inbox: inbox, agent_bot: bot)

bot_token = bot.access_token&.token || bot.access_tokens.first&.token
user_token = user.access_token&.token || user.access_tokens.first&.token

puts "CHATWOOT_ACCOUNT_ID=#{account.id}"
puts "CHATWOOT_API_TOKEN=#{bot_token}"
puts "CHATWOOT_USER_TOKEN=#{user_token}"
puts "CHATWOOT_INBOX_ID=#{inbox.id}"
puts "CHATWOOT_INBOX_IDENTIFIER=#{inbox.channel.respond_to?(:identifier) ? inbox.channel.identifier : ''}"
puts "CHATWOOT_WEBHOOK_URL=#{bot_url}"
puts "ADMIN_LOGIN=#{email} / #{password}"
RUBY
