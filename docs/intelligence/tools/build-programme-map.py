#!/usr/bin/env python3
"""Render read-only programme views; never run app code or modify source state.
Needs PyYAML in the author's tooling environment. No network or Git writes.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from collections import Counter

STATE = 'docs/intelligence/handoff/CURRENT-STATE.yaml'
CATALOG = 'docs/intelligence/03-ANALYSIS-MAP.md'
MANIFEST = 'docs/intelligence/investigations/J13-INTEGRATION-TEST-MANIFEST.yaml'
LABELS = {'active': 'Current investigation', 'aligned': 'Provisional target alignment',
          'pooled': 'Mature evidence pool', 'documented': 'Existing dossier',
          'missing': 'No dedicated dossier'}
NOTES = {'active': 'Active source analysis, not implementation or proven convergence.',
         'aligned': 'Recorded provisional target alignment; scope limits and reopen triggers still apply.',
         'pooled': 'Named mature pool in CURRENT-STATE; this is not a new convergence certification.',
         'documented': 'Dossier presence verified. Its full maturity is not inferred from file presence.',
         'missing': 'No dedicated journey dossier in the inventory. Related analysis may already exist.'}

def yaml_read(path: Path) -> dict:
    try:
        import yaml
    except ImportError as exc:
        raise ValueError('PyYAML is required in the tooling environment; no app dependency is changed.') from exc
    class UniqueLoader(yaml.SafeLoader):
        pass
    def mapping(loader, node, deep=False):
        result = {}
        for key_node, value_node in node.value:
            key = loader.construct_object(key_node, deep=deep)
            if key in result:
                raise ValueError(f'Duplicate YAML key: {key}')
            result[key] = loader.construct_object(value_node, deep=deep)
        return result
    UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, mapping)
    try:
        value = yaml.load(path.read_text(encoding='utf-8'), Loader=UniqueLoader)
    except yaml.YAMLError as exc:
        raise ValueError(f'Invalid YAML in {path}: {exc}') from exc
    if not isinstance(value, dict):
        raise ValueError(f'Expected mapping: {path}')
    return json.loads(json.dumps(value, default=str))

def parse_catalog(text: str) -> dict:
    out = {'journeys': [], 'kernels': []}
    pattern = r'^\d+\.\s+`KF-(JOURNEY|KERNEL)-(\d{3})\s+[\u2014-]\s+([^`]+)`'
    for kind, number, name in re.findall(pattern, text, re.M):
        key, prefix = ('journeys', 'J') if kind == 'JOURNEY' else ('kernels', 'K')
        out[key].append({'id': f'{prefix}{int(number)}', 'name': name.strip()})
    for key, rows in out.items():
        if not rows or len({x['id'] for x in rows}) != len(rows):
            raise ValueError(f'Empty/duplicate canonical {key} roster')
    return out

def collect(root: Path) -> dict:
    inventory = {}
    for kind, prefix in [('journeys', 'JOURNEY'), ('kernels', 'KERNEL')]:
        folder = root / 'docs/intelligence' / kind
        if not folder.is_dir():
            raise ValueError(f'Missing inventory directory: {folder}')
        inventory[kind] = sorted(p.relative_to(root).as_posix()
                                 for p in folder.glob(f'KF-{prefix}-*.md') if p.is_file())
    return {'state': yaml_read(root / STATE), 'catalog': parse_catalog((root / CATALOG).read_text(encoding='utf-8')),
            'manifest': yaml_read(root / MANIFEST), 'inventory': inventory}

def index_paths(paths: list[str], kind: str) -> dict[str, str]:
    result = {}
    prefix = 'J' if kind == 'JOURNEY' else 'K'
    for path in paths:
        match = re.fullmatch(r'docs/intelligence/(journeys|kernels)/KF-' + kind + r'-(\d{3})-[A-Z0-9-]+\.md', path)
        if not match:
            raise ValueError(f'Unexpected inventory path: {path}')
        key = f'{prefix}{int(match.group(2))}'
        if key in result:
            raise ValueError(f'Duplicate dossier identity: {key}')
        result[key] = path
    return result

def build(inputs: dict) -> dict:
    s, catalog, m = inputs['state'], inputs['catalog'], inputs['manifest']
    if s.get('project') != 'KEYFLOWOS':
        raise ValueError('Not a KEYFLOWOS state')
    ids = [x['id'] for x in catalog['journeys']]
    kids = [x['id'] for x in catalog['kernels']]
    if len(set(ids)) != len(ids) or len(set(kids)) != len(kids):
        raise ValueError('Duplicate canonical identity')
    if len(ids) != s['journey_programme']['total_canonical_journeys']:
        raise ValueError('Canonical roster and current-state total disagree')
    paths = index_paths(inputs['inventory']['journeys'], 'JOURNEY')
    kpaths = index_paths(inputs['inventory']['kernels'], 'KERNEL')
    if set(paths) - set(ids) or set(kpaths) - set(kids):
        raise ValueError('Inventory contains an identity outside the canonical roster')
    missing = [x for x in ids if x not in paths]
    if len(paths) != s['journey_programme']['dossier_count'] or set(missing) != set(s['journey_programme']['dossierless']):
        raise ValueError('STALE COVERAGE: reconcile CURRENT-STATE with the actual dossier inventory')
    groups = m['case_groups']
    cases = [c for values in groups.values() for c in values]
    if len(cases) != len(set(cases)) or len(cases) != m['expected_case_count']:
        raise ValueError('Case inventory is duplicated or has the wrong expected count')
    if len(cases) != s['integration_and_testing']['case_count']:
        raise ValueError('State and design manifest case counts disagree')
    if m['forensic_baseline'] != s['implementation_evidence']['forensic_baseline']:
        raise ValueError('Manifest/state forensic baseline mismatch')
    slices = m['slices']
    covered, done = set(), set()
    def visit(key, stack):
        if key in stack or key not in slices:
            raise ValueError(f'Invalid/cyclic slice dependency: {key}')
        if key in done:
            return
        for dep in slices[key]['requires']:
            visit(dep, stack | {key})
        done.add(key)
    for key, item in slices.items():
        visit(key, set())
        covered.update(item['cases'])
    if covered != set(cases):
        raise ValueError('Slice mapping does not match the full case inventory')
    if set(m.get('runner_bindings', {})) - set(cases):
        raise ValueError('Runner binding names an unknown case')
    pools = {}
    for pool_name, pool in s['mature_pools'].items():
        for jid in re.findall(r'(?:^|_)(J\d+)(?=_|$)', pool_name):
            if jid in pools:
                raise ValueError(f'Multiple mature-pool owners need explicit reconciliation: {jid}')
            pools[jid] = pool
    frontier = s['active_frontier']
    rows = []
    for item in catalog['journeys']:
        jid = item['id']
        pool = pools.get(jid, {})
        own = s.get(jid.lower(), {})
        raw = own.get('status', pool.get('status', ''))
        bucket = 'documented' if jid in paths else 'missing'
        if jid in pools:
            bucket = 'aligned' if 'PROVISIONALLY' in raw else 'pooled'
        if jid == frontier['primary_journey'] and str(frontier['status']).startswith('ACTIVE'):
            if jid not in paths:
                raise ValueError('Active investigation must have its committed/staged dossier')
            bucket = 'active'
        if bucket in ('aligned', 'pooled') and jid not in paths:
            raise ValueError(f'Pooled/aligned journey without dossier: {jid}')
        note = NOTES[bucket]
        if 'MAPPED_CORE_ONLY' in raw:
            note = 'Mapped core only. The whole provider estate and implementation conformance are not proven.'
        recs = pool.get('recommendations') or ([pool['recommendation']] if pool.get('recommendation') else [])
        rows.append({**item, 'bucket': bucket, 'label': LABELS[bucket], 'status_recorded': raw or 'DOSSIER_PRESENCE_ONLY',
                     'note': note, 'dossier': paths.get(jid), 'recommendations': recs, 'status_source': STATE})
    source_hash = hashlib.sha256(json.dumps(inputs, sort_keys=True, ensure_ascii=True, separators=(',', ':')).encode()).hexdigest()
    return {'schema_version': 1, 'kind': 'derived_programme_map', 'project': 'KEYFLOWOS',
            'checkpoint': s['checkpoint_id'], 'date': s['last_updated'], 'repository': s['repository'],
            'branch': s['canonical_branch'], 'input_commit': s['checkpoint_provenance']['input_intelligence_head'],
            'baseline': s['implementation_evidence']['forensic_baseline'], 'source_fingerprint': source_hash,
            'authority': STATE, 'roster_source': CATALOG, 'proof_source': MANIFEST,
            'refresh_mode': 'Regenerate from repository sources after each material tranche; no background GitHub sync.',
            'frontier': frontier, 'next_action': s['exact_next_action'],
            'implementation_authorized': s['implementation_authorized'], 'runtime_proof_executed': s['runtime_proof_executed'],
            'overall_completion_percent': None,
            'coverage': {'present': len(paths), 'total': len(ids), 'percent': round(100 * len(paths) / len(ids), 1), 'missing': missing},
            'counts': dict(Counter(row['bucket'] for row in rows)), 'journeys': rows,
            'kernels': [{**k, 'dossier': kpaths.get(k['id']), 'maturity': 'NOT_REASSESSED_BY_THIS_VIEW'} for k in catalog['kernels']],
            'proof': {'designed': len(cases), 'bound': len(m.get('runner_bindings', {})),
                      'runtime': m['all_case_runtime_status'], 'groups': groups,
                      'harness_implemented': m['harness_implemented_by_this_manifest'], 'slices': slices},
            'ranges': s['canonical_ranges'], 'debts': s['remaining_evidence_debts'],
            'history': s.get('programme_history', []), 'labels': LABELS}

def markdown(d: dict) -> str:
    cov = d['coverage']
    out = ['# KEYFLOWOS - Living Programme Map', '', '> GENERATED VIEW, not another status authority.',
           f"> Checkpoint: `{d['checkpoint']}` | As of: {d['date']}",
           '> Regenerate: `python docs/intelligence/tools/build-programme-map.py`',
           '> Verify freshness: append `--check`. Source: `handoff/CURRENT-STATE.yaml`.', '',
           f"**Current: {d['frontier']['primary_journey']} - {d['frontier']['stage']}**", '',
           f"Dossiers: **{cov['present']}/{cov['total']} ({cov['percent']:g}%)**. This is coverage, not app completion.",
           f"Tracked proof: **{d['proof']['designed']} designed cases; {d['proof']['bound']} runner bindings; {d['proof']['runtime']}**.",
           f"Production changes authorized: **{d['implementation_authorized']}**. Programme runtime proof recorded: **{d['runtime_proof_executed']}**.",
           'No whole-app completion percentage is established. Existing application code and historical test reports are not zeroed by this view.', '',
           '## Programme route', '', '```mermaid', 'flowchart LR',
           '  A[Baseline and macro model established] --> B[Journey and kernel analysis]',
           f"  B --> C[Current: {d['frontier']['primary_journey']}]", '  C --> D[Cross-system target and migration closure]',
           '  D --> E[Explicitly authorized implementation]', '  E --> F[Runtime proof and integrated acceptance]',
           '  F -. New evidence reopens earlier work .-> B', '```', '', '## All canonical journeys', '',
           '| Journey | Name | Current view | Recommendation |', '|---|---|---|---|']
    for j in d['journeys']:
        label = j['label'] + (' - mapped core only' if 'MAPPED_CORE_ONLY' in j['status_recorded'] else '')
        link = f"[{j['id']}](../../../{j['dossier']})" if j['dossier'] else j['id']
        out.append(f"| {link} | {j['name']} | {label} | {', '.join(j['recommendations']) or '-'} |")
    out += ['', 'Existing dossier is a presence check, not a fresh maturity audit. Mature pool is not synonymous with target-converged. All target alignment remains provisional.',
            '', '## Shared kernels', '', '| Kernel | Canonical responsibility | Dossier |', '|---|---|---|']
    for k in d['kernels']:
        link = f"[Present](../../../{k['dossier']})" if k['dossier'] else 'Not present in this inventory'
        out.append(f"| {k['id']} | {k['name']} | {link} |")
    out += ['', 'Kernel maturity is not independently reassessed by this generated view.', '', '## Integration path - designed, not implemented', '',
            '| Slice | Work | Depends on |', '|---|---|---|']
    for key, v in d['proof']['slices'].items():
        out.append(f"| {key} | {v['title'].replace('_', ' ')} | {', '.join(v['requires']) or '-'} |")
    out += ['', '## Outstanding evidence', '']
    out += [f"- **{k}**: {v.replace('_', ' ')}" for k, v in d['debts'].items()]
    out += ['', '## Recent committed path', '']
    for h in d['history']:
        out.append(f"- {h['label']} - `{h.get('commit') or 'this checkpoint'}`; `{h['artifact']}`")
    out += ['', '## Exact next action', '', d['next_action']['instruction'], '',
            '## Refresh and evidence rules', '',
            'Update authoritative state/dossiers first. Regenerate this Markdown, JSON and HTML together. The offline HTML can load a newer generated JSON; it does not fetch private GitHub data or change the app.',
            f"Source fingerprint: `{d['source_fingerprint']}`.",
            f"Forensic baseline: `{d['baseline']}`. Input intelligence: `{d['input_commit']}`.",
            'Generated map correctness/visual checks are documentation-tool checks, not KEYFLOWOS application or provider tests.', '']
    return '\n'.join(out)

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[3])
    ap.add_argument('--snapshot', type=Path, help='Connector-retrieved source bundle, explicitly not a repository checkout')
    ap.add_argument('--out', type=Path)
    ap.add_argument('--check', action='store_true', help='Nonzero on stale/missing outputs; never rewrite them')
    args = ap.parse_args()
    try:
        inputs = json.loads(args.snapshot.read_text(encoding='utf-8')) if args.snapshot else collect(args.root.resolve())
        d = build(inputs)
        payload = json.dumps(d, ensure_ascii=True, indent=2) + '\n'
        template = Path(__file__).with_name('programme-map.template.html').read_text(encoding='utf-8')
        if template.count('@@PROGRAMME_DATA@@') != 1:
            raise ValueError('Expected exactly one template data slot')
        html = template.replace('@@PROGRAMME_DATA@@', payload.replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026'))
        out = args.out or args.root / 'docs/intelligence/maps'
        outputs = {'PROGRAMME-MAP.json': payload, 'PROGRAMME-MAP.md': markdown(d), 'PROGRAMME-MAP.html': html}
        if args.check:
            drift = [name for name, text in outputs.items() if not (out / name).exists() or (out / name).read_text(encoding='utf-8') != text]
            if drift:
                print('STALE GENERATED MAP: ' + ', '.join(drift), file=sys.stderr)
                return 1
        else:
            out.mkdir(parents=True, exist_ok=True)
            for name, text in outputs.items():
                tmp = out / (name + '.tmp')
                tmp.write_text(text, encoding='utf-8')
                tmp.replace(out / name)
        print(json.dumps({'checkpoint': d['checkpoint'], 'dossiers': d['coverage']['present'], 'journeys': d['coverage']['total'],
                          'cases_designed': d['proof']['designed'], 'mode': 'checked' if args.check else 'generated',
                          'application_tests_run': False}))
        return 0
    except (ValueError, KeyError, TypeError, OSError) as exc:
        print(f'Cannot render trustworthy map: {exc}', file=sys.stderr)
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
