# KEYFLOWOS Project Thread Intelligence Harvester

This tool exists to prevent valuable KEYFLOWOS work from being stranded inside old ChatGPT/Claude/Kimi conversations.

## What it does

It ingests:
- ChatGPT data-export `conversations.json`;
- directories containing exported conversation JSON;
- Markdown transcripts;
- plain-text transcripts.

It then:
1. normalizes threads/messages;
2. redacts known secret shapes by default (best-effort; see [Redaction](#redaction));
3. deduplicates repeated exported messages;
4. identifies KEYFLOWOS-relevant threads;
5. scores candidate high-value messages;
6. tags candidate themes;
7. produces a review queue and machine-readable coverage report.

It does **not** decide that a chat idea is canonical. Its output is evidence for the Historical Intelligence Reconciliation programme.

## Usage

```bash
python scripts/intelligence/project_thread_harvester.py \
  --input /path/to/chatgpt-export/conversations.json \
  --output .artifacts/thread-harvest
```

Add project-specific terms when needed:

```bash
python scripts/intelligence/project_thread_harvester.py \
  --input /path/to/transcripts \
  --output .artifacts/thread-harvest \
  --project-term "KEY Cortex" \
  --project-term "Living System Atlas"
```

## Redaction

Redaction is on by default (`--no-redact` turns it off) and applies to message
text and thread titles before anything is written. It replaces the secret with
`[REDACTED]` and keeps the name, quotes, URL user and host around it. It
recognises:

- provider token shapes: Stripe secret, restricted and webhook keys
  (`sk_live_`, `sk_test_`, `rk_`, `whsec_`), GitHub tokens (`ghp_`, `gho_`,
  `ghs_`, `ghu_`, `ghr_`, `github_pat_`), GitLab and npm tokens, AWS key ids
  (`AKIA`, `ASIA` and the other IAM prefixes), Slack tokens and webhook URLs,
  Google API keys and OAuth secrets/tokens, OpenAI (`sk-`, `sk-proj-`) and
  Anthropic (`sk-ant-`) keys, Supabase access and secret keys, SendGrid keys,
  Twilio account and API key SIDs, and JSON Web Tokens (`eyJ…`, which covers
  Supabase anon and service-role keys);
- PEM private key blocks (`-----BEGIN … PRIVATE KEY-----` through `END`);
- the password in any `scheme://user:password@host` URL (Postgres, MySQL,
  MongoDB, Redis and the rest);
- `Authorization: Bearer|Basic|Token …` headers, and `Bearer <token>` where
  the token contains a digit;
- a value whose name ends in a sensitive word, in any of the forms
  `name=value`, `name: value`, `"name": "value"` (also JSON-escaped) and
  `'name': 'value'`: `password`, `passwd`, `secret`, `token`, `api_key` /
  `apiKey`, `access_key`, `private_key`, `credentials` (so `client_secret`,
  `X-Auth-Token` and `aws_secret_access_key` count; `tokens` and `max_tokens`
  do not);
- upper-case environment lines (`KEY=VALUE`, `export KEY=VALUE`, and
  `KEY_NAME: value` in YAML) whose name has a `SECRET`, `TOKEN`, `KEY`,
  `PASSWORD`, `PASSWD`, `PASS`, `PWD`, `PRIVATE`, `CREDENTIAL(S)` or `DSN`
  segment (`JWT_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`; not `KEYFLOW_ENV`);
- an AWS secret access key in a message that names AWS or holds an AWS key
  id, and a 32-hex Twilio auth token in a message that names Twilio or holds a
  Twilio account SID.

It is best-effort. A secret with no recognisable shape and no sensitive name,
such as a password typed into prose, passes through. Treat every output file
as sensitive: keep it local, and read `review-queue.md` before pasting any of
it into an issue, a pull request or a model prompt.

## Outputs

- `threads.jsonl` — normalized thread inventory
- `messages.jsonl` — normalized evidence corpus
- `candidates.jsonl` — high-value candidate artifacts
- `coverage.json` — scan coverage and parse errors
- `review-queue.md` — bounded reviewer queue

## Required downstream disposition

Every reviewed candidate must become one of:

- CURRENT
- ABSORBED
- SUPERSEDED
- IMPLEMENTED
- DUPLICATE
- REJECTED
- DEFERRED
- ORPHANED

An ORPHANED candidate is important: it means historical work appears valuable but has no proven descendant in current repository intelligence or code.

## Coverage rule

A reconciliation run is not complete merely because candidate extraction finishes.

The programme must prove:
- every source file/export included or explicitly excluded;
- parse errors resolved or accepted with reason;
- duplicate exports identified;
- every high-value candidate dispositioned;
- every CURRENT/ABSORBED/IMPLEMENTED item linked to its present owner;
- every ORPHANED item routed into review;
- every SUPERSEDED/REJECTED item keeps its rationale.

## Limitation

There is currently no repository-side API that can enumerate every ChatGPT Project thread automatically. The tool therefore requires an export/transcript source. If a future connector/API exposes Project threads, it should feed the same normalized schema rather than create a second ingestion path.
