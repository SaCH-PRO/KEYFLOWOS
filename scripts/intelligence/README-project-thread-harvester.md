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

Run it from the repository root, so the relative `--output` lands in the
top-level `.artifacts/` directory (the only place inside the checkout it may
write; see below):

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

From any other directory, give `--output` as an absolute path under the
repository root's `.artifacts/`, or a directory outside the checkout.

### Where the output may go

The outputs hold exported conversation text, so they must never be committed,
served or shipped. The harvester accepts exactly two kinds of `--output`:

- a directory outside every git work tree (not checked further);
- the work tree's top-level `.artifacts/` directory or a directory under it,
  and only while `git check-ignore` confirms every output file there is
  ignored and none is tracked.

Everything else inside a work tree is refused (exit status 3, nothing
written), ignored or not. The repository ignores `.artifacts/` at any depth,
but an ignored directory elsewhere can still leave the machine:
`apps/web/public/.artifacts/` is ignored, yet Next serves that folder over
HTTP and the web image copies it. So the relative `--output
.artifacts/thread-harvest` is accepted when run from the repository root; run from
`apps/web/public` or `scripts/intelligence` it is refused, and the message
names the absolute path to use instead. Symlinks are resolved first, and
`GIT_DIR` / `GIT_WORK_TREE` and the other git location variables are ignored
for the check, so the answer is about the work tree the output really lands
in. There is no override flag.

Exit status: 0 on success, 2 when some input files failed to parse (the rest
is still written), 3 when the output location was refused.

## Redaction

Redaction is on by default (`--no-redact` turns it off) and applies to message
text and thread titles as each file is parsed, before anything is hashed or
written. It replaces the secret with `[REDACTED]` and keeps the name, quotes,
markdown, URL user and host around it; it takes the whole value or none of it,
never leaving a marker beside the rest of a secret. It recognises:

- provider token shapes: Stripe secret, restricted and webhook keys
  (`sk_live_`, `sk_test_`, `rk_`, `whsec_`), GitHub tokens (`ghp_`, `gho_`,
  `ghs_`, `ghu_`, `ghr_`, `github_pat_`), GitLab and npm tokens, AWS key ids
  (`AKIA`, `ASIA` and the other IAM prefixes), Slack tokens and webhook URLs,
  Google API keys and OAuth secrets/tokens, OpenAI (`sk-`, `sk-proj-`) and
  Anthropic (`sk-ant-`) keys, Supabase access and secret keys, SendGrid keys,
  Twilio account and API key SIDs, and JSON Web Tokens (`eyJ…`, which covers
  Supabase anon and service-role keys);
- the other providers KEYFLOWOS configures (`.env.example`): ElevenLabs
  (`sk_` and hex), xAI (`xai-`), E2B (`e2b_`), Resend (`re_…_…`), Meta and
  WhatsApp access tokens (`EAA…`), Klaviyo private keys (`pk_`), Mailchimp
  (hex and `-usNN`), Hugging Face (`hf_`), and a LiveKit API key and secret
  written as a pair (`APIxxxx: secret`, as `livekit.yaml` and `LIVEKIT_KEYS`
  do);
- PEM private key blocks (`-----BEGIN … PRIVATE KEY-----` through `END`);
- the password in any `scheme://user:password@host` URL (Postgres, MySQL,
  MongoDB, Redis and the rest), up to the last `@` that a host follows, so a
  password holding `/`, `@` or other characters is redacted whole;
- `Authorization: Bearer|Basic|Token …` headers, and `Bearer <token>` where
  the token contains a digit;
- a value whose name ends in a sensitive word, in any of the forms
  `name=value`, `name: value`, `"name": "value"` (also JSON-escaped),
  `'name': 'value'`, `` `name`: `value` `` and `**name:** value` /
  `**name**: value` / `__name__: value`: `password`, `passwd`, `secret`,
  `token`, `api_key` / `apiKey`, `access_key`, `private_key`, `credentials`
  (so `client_secret`, `X-Auth-Token` and `aws_secret_access_key` count;
  `tokens` and `max_tokens` do not), and the same for a credential named in
  words: `API key`, `secret key`, `private key`, `encryption key`,
  `access key`, `signing key`, `master key` (so `VAPID private key: …` and
  `ElevenLabs API key: …` count; a bare `key` does not);
- upper-case environment lines (`KEY=VALUE`, `export KEY=VALUE`, and
  `KEY_NAME: value` in YAML), also backtick-quoted or in bold, whose name has
  a `SECRET`, `TOKEN`, `KEY`, `PASSWORD`, `PASSWD`, `PASS`, `PWD`, `PRIVATE`,
  `CREDENTIAL(S)` or `DSN` segment (`JWT_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`;
  not `KEYFLOW_ENV`);
- a markdown table row `| NAME | value |` whose first cell is such a name
  (`BYOK_ENCRYPTION_SECRET`, `Password`, `API key`) and whose next cell is one
  token. A description in that cell (`| JWT_SECRET | Server |`) is redacted
  too: the tool cannot tell a word from a weak password;
- command lines: `curl -u user:password` and `--user user:password` (not a
  numeric `uid:gid`), `--token`, `--password`, `--api-key`, `--secret` and
  similar flags followed by a value, and `mysql -p<password>`;
- a credential named in prose with no assignment and a generated-looking
  value (16 or more characters with a letter and a digit): `the auth token is
  …`, `and secret …`, `secret access key …`;
- an AWS secret access key in a message that names AWS or holds an AWS key
  id, a 32-hex Twilio auth token in a message that names Twilio or holds a
  Twilio account SID, and a LiveKit API secret in a message that names
  LiveKit or holds a LiveKit API key.

A bare value that is only an English function word (`` `HAWK_API_KEY`: the API
key ``, `password: required`) is left as prose. Every rule is linear in the
length of the text, so a pasted bundle of key headers or a long dotted run
cannot stall the harvester.

It is best-effort. A secret with no recognisable shape and no sensitive name,
such as a password typed into prose, passes through. So do assignments in code
written with `:=` or `=>` (excluded so arrow functions and Go declarations are
not mangled), a JSON string escaped twice, and a credential whose owner is
named only in another message of the thread (the context rules read one
message at a time). Treat every output file as sensitive: keep it local, and
read `review-queue.md` before pasting any of it into an issue, a pull request
or a model prompt.

## Outputs

- `threads.jsonl` — normalized thread inventory; `content_hash` is the sha256 of
  the thread's message texts after redaction, joined by newlines
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
