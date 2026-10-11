import importlib.util
import json
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("project_thread_harvester.py")
spec = importlib.util.spec_from_file_location("project_thread_harvester", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
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
