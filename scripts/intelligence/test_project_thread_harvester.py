import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("project_thread_harvester.py")
spec = importlib.util.spec_from_file_location("project_thread_harvester", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
# dataclasses resolves string annotations through sys.modules[cls.__module__];
# register the module before executing it, or collection fails.
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def test_parse_chatgpt_export_and_candidate_classification(tmp_path):
    payload = [{
        "id": "thread-1",
        "title": "KEYFLOWOS architecture",
        "create_time": 1,
        "update_time": 2,
        "mapping": {
            "a": {
                "message": {
                    "id": "m1",
                    "author": {"role": "user"},
                    "create_time": 1,
                    "content": {"parts": ["We decided KEYFLOWOS must preserve journey and kernel continuity."]},
                }
            }
        },
    }]
    path = tmp_path / "conversations.json"
    path.write_text(json.dumps(payload), encoding="utf-8")

    threads, messages = module.parse_chatgpt_export(payload, path)

    assert len(threads) == 1
    assert len(messages) == 1
    categories = module.categories_for(messages[0].text)
    assert "architecture" in categories
    assert "decision" in categories
    assert module.value_score(messages[0].text, categories) >= 4


def test_redacts_obvious_secret_assignments():
    text = "api_key=abc123 token: xyz password=hunter2"
    redacted = module.redact(text)
    assert "abc123" not in redacted
    assert "xyz" not in redacted
    assert "hunter2" not in redacted
    assert redacted.count("[REDACTED]") == 3


def test_plain_text_is_evidence_not_automatic_authority(tmp_path):
    path = tmp_path / "old-thread.md"
    path.write_text("KEYFLOWOS should create a new universal brain service.", encoding="utf-8")
    threads, messages = module.parse_plain_text(path)

    assert threads[0].source_kind == "text_transcript"
    assert messages[0].text.startswith("KEYFLOWOS")
    assert not hasattr(messages[0], "disposition")


# ---------------------------------------------------------------------------
# Standard-library tests. The functions above are pytest-style (they take the
# tmp_path fixture); everything below is unittest, so the suite also runs
# with no third-party package installed:
#
#   python3 -m unittest scripts/intelligence/test_project_thread_harvester.py
#
# Fixture secrets are assembled from fragments at runtime. None of them is a
# real credential, and no complete secret-shaped literal appears in this file,
# so neither a secret scanner nor push protection has anything to match.

HARVESTER = Path(__file__).with_name("project_thread_harvester.py")
MARKER = "[REDACTED]"


def secret_shapes():
    """(label, text as it would appear in a conversation, values that must not survive)."""
    hexchars = "0123456789abcdef"
    fake32 = (hexchars * 2)[:32]
    jwt = "eyJ" + "hbGciOiJub25lIn0x" + "." + "eyJ" + "zdWIiOiJmYWtlIn0x" + "." + "c2lnbmF0dXJlZmFrZQ"
    pem_body = "MIIEfake" + "A" * 56
    aws_secret = ("Fake0Secret0Access0Key0Example/" + "x" * 40)[:40]
    stripe_live = "sk_" + "live_" + "x" * 24
    stripe_test = "sk_" + "test_" + "y" * 24
    stripe_restricted = "rk_" + "live_" + "z" * 24
    stripe_webhook = "whsec_" + "w" * 32
    gh_classic = "ghp_" + "a" * 36
    gh_oauth = "gho_" + "b" * 36
    gh_server = "ghs_" + "c" * 36
    gh_fine = "github_" + "pat_" + "11" + "D" * 20 + "_" + "e" * 59
    aws_id = "AKIA" + "FAKEFAKEFAKEFAKE"
    aws_session_id = "ASIA" + "FAKEFAKEFAKEFAKE"
    slack_bot = "xox" + "b-" + "1234567890-" + "f" * 24
    slack_user = "xox" + "p-" + "1234567890-" + "g" * 24
    google = "AIza" + "Sy" + "F" * 33
    openai = "sk-" + "h" * 48
    openai_project = "sk-" + "proj-" + "i" * 48
    anthropic = "sk-" + "ant-" + "api03-" + "j" * 48
    twilio_sid = "AC" + fake32
    twilio_token = fake32[::-1]
    db_password = "Fake" + "Db" + "Pass" + "123"
    bearer = "k" * 20 + "0123456789" + "l" * 10
    json_password = "hunter" + "2" + "fake"
    json_api_key = "m" * 30
    json_token = "n" * 30
    env_value = "o" * 12 + "fake"
    return [
        ("stripe live key bare", f"Use {stripe_live} for the live charge.", [stripe_live]),
        ("stripe key assignment", f"STRIPE_SECRET_KEY={stripe_live}", [stripe_live]),
        ("stripe test key", f"test mode key {stripe_test}", [stripe_test]),
        ("stripe restricted key", f"restricted key {stripe_restricted} here", [stripe_restricted]),
        ("stripe webhook secret", f"the webhook signing secret is {stripe_webhook}", [stripe_webhook]),
        ("github classic token", f"push with {gh_classic}", [gh_classic]),
        ("github oauth token", f"gh auth gave {gh_oauth}", [gh_oauth]),
        ("github server token", f"the app token {gh_server}", [gh_server]),
        ("github fine-grained token", f"PAT {gh_fine} expires soon", [gh_fine]),
        ("aws access key id", f"aws key id {aws_id}", [aws_id]),
        ("aws session key id", f"temporary id {aws_session_id}", [aws_session_id]),
        ("aws secret assignment", f"aws_secret_access_key = {aws_secret}", [aws_secret]),
        ("aws key pair in prose", f"AWS creds: {aws_id} / {aws_secret}", [aws_id, aws_secret]),
        ("slack bot token", f"slack bot {slack_bot}", [slack_bot]),
        ("slack user token", f"slack user {slack_user}", [slack_user]),
        ("google api key", f"maps key {google}", [google]),
        ("openai key", f"OpenAI key {openai}", [openai]),
        ("openai project key", f"project key {openai_project}", [openai_project]),
        ("anthropic key", f"Claude key {anthropic}", [anthropic]),
        ("jwt bare", f"the anon key is {jwt}", [jwt]),
        ("supabase service role jwt", f"SUPABASE_SERVICE_ROLE_KEY={jwt}", [jwt]),
        (
            "pem private key block",
            "key file:\n-----BEGIN " + "PRIVATE KEY-----\n" + pem_body + "\n" + pem_body + "\n-----END " + "PRIVATE KEY-----\nend of file",
            [pem_body],
        ),
        (
            "pem rsa private key block",
            "-----BEGIN RSA " + "PRIVATE KEY-----\n" + pem_body + "\n-----END RSA " + "PRIVATE KEY-----",
            [pem_body],
        ),
        ("twilio sid and token", f'Client("{twilio_sid}", "{twilio_token}")', [twilio_sid, twilio_token]),
        ("twilio auth token env", f"TWILIO_AUTH_TOKEN={twilio_token}", [twilio_token]),
        ("postgres url", f"DATABASE_URL=postgresql://app:{db_password}@db.example.invalid:5432/app", [db_password]),
        ("postgres url in prose", f"connect to postgres://app:{db_password}@db.example.invalid/app now", [db_password]),
        ("mysql url", f"mysql://root:{db_password}@127.0.0.1:3306/x", [db_password]),
        ("mongodb srv url", f"mongodb+srv://svc:{db_password}@cluster0.example.invalid/x", [db_password]),
        ("redis url", f"REDIS_URL=redis://default:{db_password}@cache.example.invalid:6379", [db_password]),
        ("redis url without user", f"rediss://:{db_password}@cache.example.invalid:6380", [db_password]),
        ("authorization bearer header", f"curl -H 'Authorization: Bearer {bearer}' https://api.example.invalid", [bearer]),
        ("bearer token in prose", f"send Bearer {bearer} with the call", [bearer]),
        ("json password", '{"password": "' + json_password + '"}', [json_password]),
        ("json apiKey", '{"apiKey": "' + json_api_key + '", "region": "eu"}', [json_api_key]),
        ("json token", '{"token": "' + json_token + '"}', [json_token]),
        ("escaped json password", '{\\"password\\": \\"' + json_password + '\\"}', [json_password]),
        ("python dict password", "{'password': '" + json_password + "'}", [json_password]),
        ("env secret", f"JWT_SECRET={env_value}", [env_value]),
        ("env token", f"export GITHUB_TOKEN={env_value}", [env_value]),
        ("env key", f"CREDENTIALS_ENCRYPTION_KEY={env_value}", [env_value]),
        ("env password", f"DB_PASSWORD='{env_value}'", [env_value]),
        ("env private", f"SSH_PRIVATE={env_value}", [env_value]),
        ("yaml env secret", f"  BYOK_ENCRYPTION_SECRET: {env_value}", [env_value]),
        ("legacy api_key form", f"api_key={env_value}", [env_value]),
    ] + written_shapes()


def repeat(chars: str, n: int) -> str:
    return (chars * (n // len(chars) + 1))[:n]


def written_shapes():
    """Secrets written the way ChatGPT and people write them: markdown, URL
    passwords holding / or @, the provider keys KEYFLOWOS configures
    (.env.example), credential names in words, and command-line flags."""
    hexchars = "0123456789abcdef"
    mixed = "Kf7" + "qL2" + "xW9" + "pR4" + "mT8" + "vB1"
    letters = "Hq" + "Zt" + "Wm" + "Pk" + "Rv"
    password = "Tr1n" + "!dad" + "9Qx"
    token = repeat("t0K" + "e9n", 28)
    b64 = repeat("Ab3/" + "Cd4+", 64)
    hex64 = repeat("a1b2c3d4" + "e5f60798", 64)
    value = repeat("v4L" + "u3e", 24)
    url_a, url_b, url_c = "Pq7" + "Rs2", "Uv5" + "Wx8", "Yz1" + "Ab"
    elevenlabs = "sk" + "_" + repeat(hexchars, 48)
    xai = "xai" + "-" + repeat(mixed, 80)
    e2b = "e2b" + "_" + repeat(hexchars, 40)
    resend = "re" + "_" + repeat(mixed, 8) + "_" + repeat(mixed[::-1], 24)
    meta = "EA" + "AG" + repeat(mixed, 180)
    klaviyo = "pk" + "_" + repeat(hexchars, 34)
    mailchimp = repeat("13579bdf" + "02468ace", 32) + "-us" + "21"
    huggingface = "hf" + "_" + repeat(letters, 34)
    livekit_key = "API" + repeat(mixed, 12)
    livekit_secret = repeat(mixed[::-1], 43)
    vapid = repeat("Vp1_" + "Kd2-", 43)
    return [
        # SEC-CONV1-1-R1: markdown.
        ("markdown bold label", f"KEYFLOWOS staging login. **Password:** {password}", [password]),
        ("markdown bold name", f"**Password**: {password}", [password]),
        ("markdown underscore name", f"__Token__: {token}", [token]),
        ("markdown bold value", f"password: **{password}**", [password]),
        ("markdown code env name and value", f"`SUPABASE_JWT_SECRET`: `{b64}`", [b64]),
        ("markdown code env assignment", f"`JWT_SECRET`=`{value}`", [value]),
        ("markdown code password", f"`password`=`{password}`", [password]),
        ("markdown code compound env name", f"`CREDENTIALS_ENCRYPTION_KEY`: `{hex64}`", [hex64]),
        ("markdown bold env name", f"**CREDENTIALS_ENCRYPTION_KEY:** {hex64}", [hex64]),
        ("markdown table env row", f"| Name | Value |\n|---|---|\n| BYOK_ENCRYPTION_SECRET | {hex64} |", [hex64]),
        ("markdown table password row", f"| Field | Value |\n|---|---|\n| Username | admin |\n| Password | {password} |", [password]),
        ("markdown table code cells", f"| `JWT_SECRET` | `{value}` |", [value]),
        # SEC-CONV1-1-R2: URL passwords with / or @ or other URL-safe characters.
        (
            "url password with a slash",
            f"DATABASE_URL=postgresql://postgres:{url_a}/{url_b}+{url_c}@db.example.invalid:5432/postgres",
            [url_a, url_b, url_c],
        ),
        ("url password with an at sign", f"postgres://app:{url_a}@{url_b}@db.example.invalid/app", [url_a, url_b]),
        ("url password with sub-delims", f"redis://default:{url_a}!$&()*+,;=:{url_b}@cache.example.invalid:6379", [url_a, url_b]),
        # SEC-CONV1-1-R3: provider keys KEYFLOWOS configures.
        ("elevenlabs key", f"KEYFLOWOS voice uses {elevenlabs} for ElevenLabs", [elevenlabs]),
        ("xai key", f"grok fallback {xai}", [xai]),
        ("e2b key", f"sandbox {e2b}", [e2b]),
        ("resend key", f"email via Resend {resend}", [resend]),
        ("meta access token", f"WhatsApp Cloud API {meta}", [meta]),
        ("klaviyo private key", f"Klaviyo {klaviyo}", [klaviyo]),
        ("mailchimp key", f"Mailchimp {mailchimp}", [mailchimp]),
        ("hugging face token", f"model pull with {huggingface}", [huggingface]),
        ("livekit secret in prose", f"LiveKit key {livekit_key} and secret {livekit_secret}", [livekit_secret]),
        ("livekit keys yaml", f"keys:\n  {livekit_key}: {livekit_secret}", [livekit_secret]),
        # Credential names written as words.
        ("api key phrase", f"KEYFLOWOS ElevenLabs API key: {value}", [value]),
        ("private key phrase", f"push: VAPID private key: {vapid}", [vapid]),
        ("encryption key phrase", f"credentials encryption key: {hex64}", [hex64]),
        ("secret key phrase", f"Langfuse secret key = {token}", [token]),
        ("bold api key phrase", f"**API key:** {value}", [value]),
        # Command-line forms.
        ("curl user and password", f"curl -u admin:{password} https://api.example.invalid/v1", [password]),
        ("token flag", f"npx vercel deploy --prod --token {token}", [token]),
        ("password flag", f"docker login registry.example.invalid --username ci --password {password}", [password]),
        ("quoted password flag", f"tool --db-password '{password}' --verbose", [password]),
        ("api key flag", f"cli --api-key {value} run", [value]),
        ("mysql attached password", f"mysql -uroot -p{password} keyflow", [password]),
    ]


# Prose and configuration that only look like secrets. None of it may change.
ORDINARY_PROSE = (
    "We decided KEYFLOWOS must keep the KEY assistant honest: the key decision is that "
    "a token budget is not a secret, the password reset flow stays manual, and tokens "
    "are counted per request. Bearer of bad news: the bearer authentication docs moved. "
    "Commit 1d60043585f6747a44d09b3066d3fb2f296be2dd fixed task-runner retries; see "
    "https://example.com/docs?page=2 and http://localhost:3001/healthz. The CI database "
    "is postgresql://keyflow@localhost:5432/keyflowos with trust auth. Config near-misses: "
    "KEYFLOW_ENV=production, MAX_TOKENS=4096, {\"tokens\": 1500, \"key\": \"theme\"}, "
    "request id 3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b, email ops@example.com."
)

# Near misses for the markdown, provider, phrase and command-line rules.
ORDINARY_COMMANDS = (
    "Run `docker run -u 1000:1000 app`, `git push -u origin main`, `sudo -u postgres psql`, "
    "`docker login --password-stdin` and `mysql -u root -p keyflow` (it prompts). The API key "
    "rotation runbook and the secret santa list live at https://example.com/@team/keys; `max_tokens` "
    "stays 4096 and the token budget is 4096 tokens; hf_hub_download, e2b_sandbox and re_compile are "
    "function names; the xai-sdk package is pinned.\n| Key | Value |\n|---|---|\n| Name | Description |\n"
    "- `HAWK_API_KEY`: the API key. `JWT_SECRET`: see the vault. The password: required."
)


class RedactSecretShapesTest(unittest.TestCase):
    def test_each_secret_shape_is_redacted(self):
        for label, text, secrets in secret_shapes():
            with self.subTest(shape=label):
                redacted = module.redact(text)
                for value in secrets:
                    self.assertNotIn(value, redacted, f"{label}: value survived redaction: {redacted!r}")
                self.assertIn(MARKER, redacted, f"{label}: no redaction marker in {redacted!r}")

    def test_redaction_is_idempotent(self):
        for label, text, _ in secret_shapes():
            with self.subTest(shape=label):
                once = module.redact(text)
                self.assertEqual(module.redact(once), once)

    def test_ordinary_prose_is_untouched(self):
        self.assertEqual(module.redact(ORDINARY_PROSE), ORDINARY_PROSE)
        self.assertEqual(module.redact(ORDINARY_COMMANDS), ORDINARY_COMMANDS)

    def test_markdown_and_url_forms_keep_their_markup_and_lose_the_whole_value(self):
        # SEC-CONV1-1-R1/R2: the marker replaces the value, all of it, and
        # nothing else; it never sits next to the value it claims to hide.
        secret = "Tr1n" + "!dad" + "9Qx"
        head, tail = "Pq7" + "Rs2", "Uv5" + "Wx8"
        cases = [
            (f"**Password:** {secret}", "**Password:** [REDACTED]"),
            (f"**Password**: {secret}", "**Password**: [REDACTED]"),
            (f"__Token__: {secret}", "__Token__: [REDACTED]"),
            (f"password: **{secret}**", "password: **[REDACTED]**"),
            (f"`JWT_SECRET`: `{secret}`", "`JWT_SECRET`: `[REDACTED]`"),
            (f"`password`=`{secret}`", "`password`=`[REDACTED]`"),
            (f"**CREDENTIALS_ENCRYPTION_KEY:** {secret}", "**CREDENTIALS_ENCRYPTION_KEY:** [REDACTED]"),
            (f"| BYOK_ENCRYPTION_SECRET | {secret} |", "| BYOK_ENCRYPTION_SECRET | [REDACTED] |"),
            (f"| `JWT_SECRET` | `{secret}` |", "| `JWT_SECRET` | `[REDACTED]` |"),
            (f"ElevenLabs API key: {secret}", "ElevenLabs API key: [REDACTED]"),
            (
                f"postgres://app:{head}@{tail}@db.example.invalid:5432/app?sslmode=require",
                "postgres://app:[REDACTED]@db.example.invalid:5432/app?sslmode=require",
            ),
            (
                f"postgresql://postgres:{head}/{tail}+x@db.example.invalid:5432/postgres",
                "postgresql://postgres:[REDACTED]@db.example.invalid:5432/postgres",
            ),
            (f"curl -u admin:{secret} https://api.example.invalid", "curl -u admin:[REDACTED] https://api.example.invalid"),
            (f"mysql -uroot -p{secret} keyflow", "mysql -uroot -p[REDACTED] keyflow"),
        ]
        for text, expected in cases:
            with self.subTest(text=expected):
                self.assertEqual(module.redact(text), expected)

    def test_legacy_assignment_forms_still_redact(self):
        text = "api_key=abc123 token: xyz password=hunter2"
        redacted = module.redact(text)
        for value in ("abc123", "xyz", "hunter2"):
            self.assertNotIn(value, redacted)
        self.assertEqual(redacted.count(MARKER), 3)


class RedactionTimeTest(unittest.TestCase):
    """SEC-CONV1-1-R6: redaction stays linear on inputs built to make a rule
    backtrack. The private-key rule used to rescan to the end of the text for
    every BEGIN header with no END (4,000 headers took over 3 s, 10,000 took
    20 s), and the URL rule rescanned a dotted or dashed run from each of its
    characters (100,000 characters took 5 s). Each input here is sized so the
    old rules take seconds and the linear ones a fraction of the limit."""

    LIMIT_SECONDS = 0.5

    def assert_fast(self, label: str, text: str) -> str:
        start = time.perf_counter()
        out = module.redact(text)
        elapsed = time.perf_counter() - start
        self.assertLess(elapsed, self.LIMIT_SECONDS, f"{label}: redact took {elapsed:.2f} s on {len(text)} characters")
        return out

    def test_many_private_key_headers_without_an_end(self):
        header = "-----BEGIN " + "PRIVATE KEY-----\n"
        out = self.assert_fast("unterminated private key headers", header * 4_000)
        self.assertIn(MARKER, out)

    def test_other_backtracking_shapes(self):
        cases = {
            "private key header without END, then a long body": "-----BEGIN " + "RSA PRIVATE KEY-----\n" + "QUJD" * 100_000,
            "dotted run (URL scheme candidates)": "a." * 50_000,
            "dashed run": "a-" * 50_000,
            "scheme-like tokens": "x://y:" * 20_000,
            "at signs after a URL user": "postgres://u:" + "p@" * 50_000,
            "identifier run": "a" * 200_000,
            "environment-name run": "A_" * 50_000,
            "table pipes": "| SECRET " * 10_000,
            "flag prefixes": "--a-" * 25_000,
            "sensitive words": "token secret password " * 5_000,
            "mysql words": "mysql " * 20_000,
        }
        for label, text in cases.items():
            with self.subTest(shape=label):
                self.assert_fast(label, text)


def write_export(path: Path, title: str, texts: list[str]) -> None:
    mapping = {}
    for index, text in enumerate(texts):
        mapping[f"n{index}"] = {
            "message": {
                "id": f"m{index:03d}",
                "author": {"role": "user"},
                "create_time": 1_700_000_000 + index,
                "content": {"parts": [text]},
            }
        }
    payload = [{"id": "thread-secrets", "title": title, "create_time": 1, "update_time": 2, "mapping": mapping}]
    path.write_text(json.dumps(payload), encoding="utf-8")


def run_harvester(*args: str, cwd: Path | None = None, env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(HARVESTER), *args],
        capture_output=True,
        text=True,
        cwd=str(cwd) if cwd else None,
        env=env,
    )


class HarvestOutputRedactionTest(unittest.TestCase):
    """Every shape is redacted in messages.jsonl, candidates.jsonl and review-queue.md."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_secrets_are_absent_from_every_output_and_prose_survives(self):
        shapes = secret_shapes()
        texts = [f"KEYFLOWOS evidence ({label}): {text}" for label, text, _ in shapes] + [ORDINARY_PROSE]
        title_secret = "ghp_" + "t" * 36
        export = self.tmp / "conversations.json"
        write_export(export, f"KEYFLOWOS thread {title_secret}", texts)
        output = self.tmp / "harvest"

        result = run_harvester("--input", str(export), "--output", str(output), "--min-score", "0")
        self.assertEqual(result.returncode, 0, result.stderr)

        messages = [json.loads(line) for line in (output / "messages.jsonl").read_text(encoding="utf-8").splitlines()]
        candidates = [json.loads(line) for line in (output / "candidates.jsonl").read_text(encoding="utf-8").splitlines()]
        queue = (output / "review-queue.md").read_text(encoding="utf-8")
        self.assertEqual(len(messages), len(texts))
        self.assertEqual(len(candidates), len(texts), "every message must reach the review queue for this test to prove anything")

        outputs = {
            "messages.jsonl": (output / "messages.jsonl").read_text(encoding="utf-8"),
            "candidates.jsonl": (output / "candidates.jsonl").read_text(encoding="utf-8"),
            "review-queue.md": queue,
            "threads.jsonl": (output / "threads.jsonl").read_text(encoding="utf-8"),
            "coverage.json": (output / "coverage.json").read_text(encoding="utf-8"),
        }
        message_text = "\n".join(m["text"] for m in messages)
        candidate_text = "\n".join(c["excerpt"] for c in candidates)
        for label, _, secrets in shapes:
            for value in secrets:
                with self.subTest(shape=label):
                    # Check the decoded text as well as the raw file, so JSON
                    # escaping cannot hide a surviving value.
                    self.assertNotIn(value, message_text, f"{label} survived in messages.jsonl")
                    self.assertNotIn(value, candidate_text, f"{label} survived in candidates.jsonl")
                    for name, content in outputs.items():
                        self.assertNotIn(value, content, f"{label} survived in {name}")
        for name, content in outputs.items():
            self.assertNotIn(title_secret, content, f"a secret in the thread title survived in {name}")

        self.assertIn(ORDINARY_PROSE, [m["text"] for m in messages], "prose changed in messages.jsonl")
        self.assertIn(ORDINARY_PROSE, [c["excerpt"] for c in candidates], "prose changed in candidates.jsonl")
        self.assertIn(ORDINARY_PROSE, queue.splitlines(), "prose changed in review-queue.md")

    def read_jsonl(self, path: Path) -> list[dict]:
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]

    def test_thread_content_hash_is_over_the_redacted_text(self):
        # SEC-CONV1-1-R4: messages.jsonl holds every other byte of the thread,
        # so a hash of the unredacted thread lets a weak password be guessed.
        weak = "Trin" + "idad#1"
        raw = [f"KEYFLOWOS admin password: {weak} (rotate after demo)", "KEYFLOWOS: we decided the kernel stays small."]
        export = self.tmp / "conversations.json"
        write_export(export, "KEYFLOWOS admin", raw)
        transcript = self.tmp / "transcripts" / "old-thread.md"
        transcript.parent.mkdir()
        transcript.write_text(f"KEYFLOWOS staging password: {weak}\n", encoding="utf-8")
        output = self.tmp / "harvest"

        for source in (export, transcript):
            with self.subTest(source=source.name):
                result = run_harvester("--input", str(source), "--output", str(output), "--min-score", "0")
                self.assertEqual(result.returncode, 0, result.stderr)
                threads = self.read_jsonl(output / "threads.jsonl")
                messages = self.read_jsonl(output / "messages.jsonl")
                self.assertEqual(len(threads), 1)
                written = "\n".join(m["text"] for m in messages)
                self.assertNotIn(weak, written)
                self.assertEqual(threads[0]["content_hash"], hashlib.sha256(written.encode("utf-8")).hexdigest())
                unredacted = written.replace(MARKER, weak)
                self.assertNotEqual(threads[0]["content_hash"], hashlib.sha256(unredacted.encode("utf-8")).hexdigest())
                for message in messages:
                    self.assertEqual(message["text_hash"], hashlib.sha256(message["text"].encode("utf-8")).hexdigest())

    def test_thread_titles_get_the_same_redaction(self):
        # SEC-CONV1-1-R5: titles go through redact() too, so every new form
        # is covered there as well.
        shapes = written_shapes()
        output = self.tmp / "harvest"
        export = self.tmp / "conversations.json"
        payload = []
        for index, (label, text, _) in enumerate(shapes):
            payload.append({"id": f"t{index}", "title": f"KEYFLOWOS {text}", "create_time": 1, "update_time": 2, "mapping": {}})
        export.write_text(json.dumps(payload), encoding="utf-8")
        result = run_harvester("--input", str(export), "--output", str(output), "--min-score", "0")
        self.assertEqual(result.returncode, 0, result.stderr)
        raw = (output / "threads.jsonl").read_text(encoding="utf-8")
        titles = {t["thread_id"]: t["title"] for t in self.read_jsonl(output / "threads.jsonl")}
        for index, (label, _, secrets) in enumerate(shapes):
            with self.subTest(shape=label):
                self.assertIn(MARKER, titles[f"t{index}"])
                for value in secrets:
                    self.assertNotIn(value, titles[f"t{index}"])
                    self.assertNotIn(value, raw)
        self.assertIn("ElevenLabs API key: [REDACTED]", raw)



def isolated_git_env() -> dict[str, str]:
    """The caller's environment with global and system git config switched
    off, so a personal excludesFile cannot make an unignored path look ignored."""
    env = dict(os.environ)
    env["GIT_CONFIG_GLOBAL"] = os.devnull
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    for name in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"):
        env.pop(name, None)
    return env


OUTPUT_FILES = ("threads.jsonl", "messages.jsonl", "candidates.jsonl", "coverage.json", "review-queue.md")


@unittest.skipUnless(shutil.which("git"), "git is not installed")
class OutputLocationGuardTest(unittest.TestCase):
    """--output inside a git work tree must be a path git ignores."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.env = isolated_git_env()
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True, env=self.env)
        (self.repo / ".gitignore").write_text("**/.artifacts/\n", encoding="utf-8")
        (self.repo / "scripts" / "intelligence").mkdir(parents=True)
        self.export = self.tmp / "conversations.json"
        write_export(self.export, "KEYFLOWOS thread", ["KEYFLOWOS: we decided the kernel must stay small."])

    def tearDown(self):
        self._tmp.cleanup()

    def harvest(self, output: str, *extra: str, cwd: Path | None = None) -> subprocess.CompletedProcess:
        return run_harvester("--input", str(self.export), "--output", output, *extra, cwd=cwd, env=self.env)

    def test_refuses_an_unignored_output_inside_the_work_tree(self):
        output = self.repo / "harvest"
        result = self.harvest(str(output))
        self.assertEqual(result.returncode, 3, result.stderr)
        self.assertIn("not ignored by git", result.stderr)
        self.assertIn("--allow-unignored-output", result.stderr)
        self.assertFalse(output.exists(), "a refused run must not create the output directory")

    def test_refuses_the_documented_command_run_from_a_subdirectory_when_unignored(self):
        # The same relative --output the README shows, from another directory,
        # with a .gitignore that only covers the root-level directory (the
        # rule before this fix).
        (self.repo / ".gitignore").write_text(".artifacts/thread-harvest/\n", encoding="utf-8")
        cwd = self.repo / "scripts" / "intelligence"
        result = self.harvest(".artifacts/thread-harvest", cwd=cwd)
        self.assertEqual(result.returncode, 3, result.stderr)
        self.assertFalse((cwd / ".artifacts").exists())

    def test_accepts_an_ignored_output_at_any_depth(self):
        cwd = self.repo / "scripts" / "intelligence"
        result = self.harvest(".artifacts/thread-harvest", cwd=cwd)
        self.assertEqual(result.returncode, 0, result.stderr)
        for name in OUTPUT_FILES:
            self.assertTrue((cwd / ".artifacts" / "thread-harvest" / name).is_file(), name)
        status = subprocess.run(
            ["git", "-C", str(self.repo), "status", "--porcelain", "--untracked-files=all"],
            capture_output=True, text=True, check=True, env=self.env,
        )
        self.assertNotIn(".artifacts", status.stdout, "harvest output would be offered to git add")

    def test_refuses_an_output_whose_files_are_tracked(self):
        output = self.repo / ".artifacts" / "thread-harvest"
        output.mkdir(parents=True)
        (output / "messages.jsonl").write_text("", encoding="utf-8")
        subprocess.run(["git", "-C", str(self.repo), "add", "-f", ".artifacts/thread-harvest/messages.jsonl"], check=True, env=self.env)
        result = self.harvest(str(output))
        self.assertEqual(result.returncode, 3, result.stderr)
        self.assertEqual((output / "messages.jsonl").read_text(encoding="utf-8"), "")

    def test_allow_flag_writes_with_a_loud_warning(self):
        output = self.repo / "harvest"
        result = self.harvest(str(output), "--allow-unignored-output")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("WARNING", result.stderr)
        self.assertIn("not ignored by git", result.stderr)
        self.assertTrue((output / "messages.jsonl").is_file())

    def test_output_outside_any_work_tree_is_accepted(self):
        output = self.tmp / "elsewhere"
        result = self.harvest(str(output))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertTrue((output / "messages.jsonl").is_file())


@unittest.skipUnless(shutil.which("git"), "git is not installed")
class RepositoryIgnoreRuleTest(unittest.TestCase):
    """The repository's .gitignore keeps harvester output local wherever it is run."""

    def test_artifacts_directories_are_ignored_at_any_depth(self):
        root = Path(__file__).resolve().parents[2]
        env = isolated_git_env()
        inside = subprocess.run(["git", "-C", str(root), "rev-parse", "--is-inside-work-tree"], capture_output=True, text=True, env=env)
        if inside.returncode != 0 or inside.stdout.strip() != "true":
            self.skipTest("not running from a git checkout")
        for rel in (
            ".artifacts/thread-harvest/messages.jsonl",
            ".artifacts/harvest/review-queue.md",
            "scripts/intelligence/.artifacts/thread-harvest/messages.jsonl",
            "scripts/.artifacts/thread-harvest/candidates.jsonl",
            # Bytecode of this test holds its fixtures as folded literals.
            "scripts/intelligence/__pycache__/test_project_thread_harvester.cpython-313.pyc",
        ):
            with self.subTest(path=rel):
                result = subprocess.run(["git", "-C", str(root), "check-ignore", "-q", "--no-index", "--", rel], env=env)
                self.assertEqual(result.returncode, 0, f"{rel} is not ignored by the repository .gitignore")

class PytestStyleTestsUnderUnittest(unittest.TestCase):
    """Runs the pytest-style functions above with a temporary directory, so a
    stdlib-only run covers them too."""

    def _tmp_path(self) -> Path:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        return Path(tmp.name)

    def test_parse_chatgpt_export_and_candidate_classification(self):
        test_parse_chatgpt_export_and_candidate_classification(self._tmp_path())

    def test_redacts_obvious_secret_assignments(self):
        test_redacts_obvious_secret_assignments()

    def test_plain_text_is_evidence_not_automatic_authority(self):
        test_plain_text_is_evidence_not_automatic_authority(self._tmp_path())


if __name__ == "__main__":
    unittest.main()
