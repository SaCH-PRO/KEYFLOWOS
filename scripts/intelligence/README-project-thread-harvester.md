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
2. redacts obvious secrets by default;
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
