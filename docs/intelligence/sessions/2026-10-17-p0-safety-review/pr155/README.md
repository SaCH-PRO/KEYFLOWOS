# PR155 independent semantic review evidence

**Verdict: PASS for KF-EXEC-AUTH-FAIL-CLOSED-001's parsed-command authority boundary.** No unresolved substantive finding was identified within that packet. This was a fresh review of the integrated artifact tree, including its original focused suite and eight mutation controls. It supplies no merge, draft transition, production or control-plane admission authority.

## Reviewed identity and scope

| Identity | Exact commit |
| --- | --- |
| Repository | SaCH-PRO/KEYFLOWOS, PR155 |
| Reviewed semantic head | `fe79181638e373584c3ca3184a39343a132040cd` |
| Final reviewed artifact head | `a597c692fcb102de558dd832d88738c0402f69a2` |
| Base main | `98ee0202499ba87fa4ee13d58a2a9075016225bd` |
| Previous reviewed semantic head | `8987f6db21a839f90c88e33479768d81cef508e9` |

The diff from base contains exactly the two packet metadata files, the pipeline, its focused test, and its negative-controls manifest:

- `.agent-control/active-packet.yaml`
- `.agent-control/claude-return.yaml`
- `apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts`
- `apps/server/src/modules/key-cortex/__tests__/key-cortex-query-pipeline.service.spec.ts`
- `scripts/proof-admission/manifests/auth-fail-closed-001-negative-controls.json`

The three semantic/proof files are byte-identical between the previous reviewed semantic head and the final artifact head, and between the current semantic head and the final artifact head. The prior PASS was not used as a substitute for this review. Both metadata files were read; live control-plane status remains the responsibility of the separate admission review.

## Technical conclusion and source anchors

The parsed-command executable accumulator starts empty ([pipeline line 410](https://github.com/SaCH-PRO/KEYFLOWOS/blob/fe79181638e373584c3ca3184a39343a132040cd/apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts#L410)). The pipeline validates each returned authority verdict ([line 444](https://github.com/SaCH-PRO/KEYFLOWOS/blob/fe79181638e373584c3ca3184a39343a132040cd/apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts#L444)) and publishes the approved command set only after the whole evaluation loop succeeds ([line 468](https://github.com/SaCH-PRO/KEYFLOWOS/blob/fe79181638e373584c3ca3184a39343a132040cd/apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts#L468)). A throw or unusable verdict therefore leaves the entire parsed batch non-executable, including an approved prefix.

The structural validator requires boolean `allowed`, boolean `requiresApproval`, and one of the recognized tiers ([line 1663](https://github.com/SaCH-PRO/KEYFLOWOS/blob/fe79181638e373584c3ca3184a39343a132040cd/apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts#L1663)). The missing-oracle fallback is a complete ordinary denying verdict ([line 437](https://github.com/SaCH-PRO/KEYFLOWOS/blob/fe79181638e373584c3ca3184a39343a132040cd/apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts#L437)); authority failure is separately reported as `authority_check_failed_closed` in STEP_5 evidence ([line 482](https://github.com/SaCH-PRO/KEYFLOWOS/blob/fe79181638e373584c3ca3184a39343a132040cd/apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts#L482)).

Both inspected verdict producers provide the required shape: [AutonomyOrchestratorService line 418](https://github.com/SaCH-PRO/KEYFLOWOS/blob/fe79181638e373584c3ca3184a39343a132040cd/apps/server/src/modules/key-autonomy/autonomy-orchestrator.service.ts#L418) and [KeyCortexGenomeBridgeService line 224](https://github.com/SaCH-PRO/KEYFLOWOS/blob/fe79181638e373584c3ca3184a39343a132040cd/apps/server/src/modules/key-cortex/key-cortex-genome-bridge.service.ts#L224). Existing valid allow, deny, manual, and approval-required behavior is preserved at the reviewed boundary.

## Recorded evidence

| File, relative to this directory | Result | Bytes |
| --- | --- | ---: |
| `focused-original-report.json` | Original focused suite: 27 passed, 0 failed, 0 skipped; exit 0 | 12,034 |
| `negative-controls-report.json` | Baseline 27/27; 8 live controls, 0 vacuous; exit 0 | 4,766 |
| `historical-assertion-report.json` | One expected assertion failure after restoring historical fail-open initialization; child exit 1 | 13,658 |

Absolute original evidence paths:

- `/tmp/kf155-probes/focused-original-report.json`
- `/tmp/kf155-probes/negative-controls-report.json`
- `/tmp/kf155-probes/historical-assertion-report.json`

SHA-256:

```text
bf83b1f5a6e99f5e72992189b1b115c7e5849e800ce0ea543567d69e1f6305de  focused-original-report.json
3f24571c1d25d80accdb7e20c626af3c3cab3f7ee88c83baf7cbb75669faa41e  negative-controls-report.json
5b996b2740ec119132866f1da5c7306de95a20306b539f78d1eff161573b4531  historical-assertion-report.json
```

The direct historical control failed with `AssertionError: expected "spy" to not be called at all, but actually been called 1 times`. This is the intended negative proof: reverting the fix makes the executor-call assertion detect the unsafe behavior. The wrapper completed successfully and restored the original source.

The eight controls independently exposed historical fail-open initialization (5/5 named failures), partial-prefix publication (2/2), unusable-verdict acceptance (3/3), failure misreported as evaluated (2/2), omitted approval semantics (6/6), unchecked `requiresApproval` (2/2), unchecked tier (2/2), and incomplete no-oracle fallback (1/1). Counts are per control and are not distinct tests to add to the 27-test suite.

## Limits of the verdict

**Local runtime:** Node 24.19.0 was available locally; the repository expects Node 20.18.1 and pnpm 9.15.0. Vitest 2.1.9, TypeScript 5.9.3 and Prisma client 6.19.2 were used. Direct dependency versions were selected from the repository lock and installed in isolation with npm and `--ignore-scripts`. This was not a full frozen pnpm install. Future npm resolution of transitive dependencies may differ. The original test/configuration/manifest/runner were used unchanged.

**Request scope:** This packet does not establish a whole-request side-effect prohibition. The later [tool loop, line 670](https://github.com/SaCH-PRO/KEYFLOWOS/blob/fe79181638e373584c3ca3184a39343a132040cd/apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts#L670), [text-detection fallback, line 865](https://github.com/SaCH-PRO/KEYFLOWOS/blob/fe79181638e373584c3ca3184a39343a132040cd/apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts#L865), and [streaming path, line 1493](https://github.com/SaCH-PRO/KEYFLOWOS/blob/fe79181638e373584c3ca3184a39343a132040cd/apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts#L1493) remain separate. Adjacent ActionsService and Executor paths have their own authority checks; the original parsed-batch failure is not propagated as a request-wide prohibition. The informational survival fixture uses plain `Hello` and an empty detector, so it does not establish behavior for arbitrary model output.

**Pre-existing executor contract mismatch:** The [focused mock, line 359](https://github.com/SaCH-PRO/KEYFLOWOS/blob/fe79181638e373584c3ca3184a39343a132040cd/apps/server/src/modules/key-cortex/__tests__/key-cortex-query-pipeline.service.spec.ts#L359) returns an array from `executeBatch`. The [actual method, line 467](https://github.com/SaCH-PRO/KEYFLOWOS/blob/fe79181638e373584c3ca3184a39343a132040cd/apps/server/src/modules/key-cortex/key-cortex-executor.service.ts#L467) returns a `BatchResult` object ([return, line 589](https://github.com/SaCH-PRO/KEYFLOWOS/blob/fe79181638e373584c3ca3184a39343a132040cd/apps/server/src/modules/key-cortex/key-cortex-executor.service.ts#L589)). Existing pipeline `results.map` calls at [line 830](https://github.com/SaCH-PRO/KEYFLOWOS/blob/fe79181638e373584c3ca3184a39343a132040cd/apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts#L830) and [line 1497](https://github.com/SaCH-PRO/KEYFLOWOS/blob/fe79181638e373584c3ca3184a39343a132040cd/apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts#L1497) do not match that real shape. This is unchanged by PR155. The passing allow test demonstrates invocation of the executor boundary, not successful processing of its real return value or end-to-end execution.

**Existing supervised policy:** A structurally valid `{ allowed: true, requiresApproval: false, tier: 'supervised' }` remains executable. Inspected current producers pair supervised with approval required. Tightening that cross-field relationship is a separate policy decision.

No full server test suite, full application build/typecheck, lint, database integration, live provider workflow, or production execution was performed by this review. Only the prerequisite shared and DB packages were compiled to load the faithful focused tests. No claim is made about live CI, current admission status or broad Flow/KEY safety.

## Exact preparation commands

These commands describe the completed run. Use fresh disposable directories for a new reproduction: npm/symlink commands assume the shown layout, and rerunning the report commands would overwrite the retained evidence. The initial source checkout was already pinned to the final artifact head.

Public dependency downloads required the environment's approved network execution route. Installation used `--ignore-scripts`; Prisma generation was an explicit separate step. The placeholder URL below is not a real database and no database connection was used.

```bash
mkdir -p /tmp/kf155-probes
git clone --shared --no-hardlinks /tmp/keyflow-pr155-review /tmp/kf155-probes/repo
git -C /tmp/kf155-probes/repo rev-parse HEAD

npm install --prefix /tmp/kf155-probes/deps --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=20000 vitest@2.1.9 typescript@5.9.3 @nestjs/common@11.1.19 reflect-metadata@0.2.2 rxjs@7.8.1

npm install --prefix /tmp/kf155-probes/deps --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=20000 tailwindcss@3.4.19 autoprefixer@10.4.24 postcss@8.5.13 @nestjs/core@11.1.19 @nestjs/event-emitter@3.1.0 @nestjs/schedule@6.1.3 @aws-sdk/client-s3@3.1041.0 @aws-sdk/s3-request-presigner@3.1041.0 @modelcontextprotocol/sdk@1.29.0 @prisma/client@6.19.2 prisma@6.19.2 @prisma/adapter-pg@7.3.0 @sentry/nestjs@10.53.1 pg@8.18.0 dotenv@16.6.1 csv-parse@5.6.0 date-fns@4.1.0 docx@9.7.1 exceljs@4.4.0 mammoth@1.12.0 openai@4.104.0 pdfkit@0.18.0 resend@4.8.0 sanitize-html@2.17.3 zod@3.25.76

ln -s /tmp/kf155-probes/deps/node_modules /tmp/kf155-probes/repo/node_modules
ln -s /tmp/kf155-probes/deps/node_modules /tmp/kf155-probes/repo/apps/server/node_modules

node - <<'JS'
const fs=require('fs');
fs.mkdirSync('/tmp/kf155-probes/deps/node_modules/@keyflow',{recursive:true});
for(const pkg of ['db','shared'])
  fs.symlinkSync('/tmp/kf155-probes/repo/packages/'+pkg,
    '/tmp/kf155-probes/deps/node_modules/@keyflow/'+pkg,'dir');
JS

DATABASE_URL='postgresql://offline:offline@127.0.0.1:1/offline' node /tmp/kf155-probes/deps/node_modules/prisma/build/index.js generate --schema /tmp/kf155-probes/repo/packages/db/prisma/schema.prisma

node /tmp/kf155-probes/deps/node_modules/typescript/bin/tsc --project /tmp/kf155-probes/repo/packages/shared/tsconfig.json
node /tmp/kf155-probes/deps/node_modules/typescript/bin/tsc --project /tmp/kf155-probes/repo/packages/db/tsconfig.json
```

The checked-out HEAD must print `a597c692fcb102de558dd832d88738c0402f69a2`. Both prerequisite TypeScript builds exited 0. They are not evidence of a full server build.

## Original focused suite

Working directory: `/tmp/kf155-probes/repo/apps/server`.

```bash
env -u DATABASE_URL -u DIRECT_URL -u OPENAI_API_KEY -u AI_INTEGRATIONS_OPENAI_API_KEY node node_modules/vitest/vitest.mjs run -c vitest.unit.config.ts src/modules/key-cortex/__tests__/key-cortex-query-pipeline.service.spec.ts --reporter=json --outputFile=/tmp/kf155-probes/focused-original-report.json
```

Expected clean result: 27 passed, zero failed or skipped, exit 0. The repository configuration shuffles test order; a seed was not recorded for this passing run.

## Original mutation manifest and runner

Working directory: `/tmp/kf155-probes/repo`.

```bash
env -u DATABASE_URL -u DIRECT_URL -u OPENAI_API_KEY -u AI_INTEGRATIONS_OPENAI_API_KEY node scripts/proof-admission/negative-controls.mjs --manifest scripts/proof-admission/manifests/auth-fail-closed-001-negative-controls.json --out /tmp/kf155-probes/negative-controls-report.json
```

Expected result: clean 27/27 baseline, eight live controls, zero vacuous controls, exit 0. The original runner temporarily mutates source and restores it. Run this sequentially in the disposable clone, without concurrent source edits.

## Direct assertion capture for the historical defect

This additional completed probe captured the actual assertion from one named test. It used the unchanged focused spec and restored source in a `finally` block.

```bash
env -u DATABASE_URL -u DIRECT_URL -u OPENAI_API_KEY -u AI_INTEGRATIONS_OPENAI_API_KEY node - <<'JS'
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root='/tmp/kf155-probes/repo';
const file=path.join(root,'apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts');
const original=fs.readFileSync(file,'utf8');
const find='      let autonomyCheckedCommands: typeof parsedCommands = [];';
if(original.split(find).length!==2)throw new Error('Historical mutation target is not unique');
const report='/tmp/kf155-probes/historical-assertion-report.json';
let run;
try {
 fs.writeFileSync(file,original.replace(find,'      let autonomyCheckedCommands = parsedCommands;'));
 run=cp.spawnSync(process.execPath,[path.join(root,'apps/server/node_modules/vitest/vitest.mjs'),'run','-c','vitest.unit.config.ts','src/modules/key-cortex/__tests__/key-cortex-query-pipeline.service.spec.ts','-t','AUTH-FC-P01 an autonomy evaluation that throws leaves zero parsed commands executable','--reporter=json','--outputFile='+report],{cwd:path.join(root,'apps/server'),env:process.env,encoding:'utf8',timeout:45000,maxBuffer:8*1024*1024});
} finally {fs.writeFileSync(file,original);}
const result=JSON.parse(fs.readFileSync(report,'utf8'));
const failures=result.testResults.flatMap(s=>s.assertionResults??[]).filter(a=>a.status==='failed');
console.log(JSON.stringify({exit:run.status,failed:result.numFailedTests,failures:failures.map(a=>({name:a.fullName,message:a.failureMessages?.[0]?.split('\n').slice(0,5).join('\n')})),restored:fs.readFileSync(file,'utf8')===original},null,2));
if(run.status!==1||failures.length!==1||!failures[0].failureMessages.some(m=>m.includes('AssertionError')))process.exit(2);
JS
```

The child exited 1 with one assertion failure, the wrapper exited 0, and `restored` was true.

## Source restoration and scope checks

After all probes, these commands completed cleanly:

```bash
git -C /tmp/keyflow-pr155-review status --short
git -C /tmp/kf155-probes/repo diff --exit-code
```

The original review checkout had no changes; the disposable clone retained no tracked source diff. Dependency links, generated clients and prerequisite build products were confined to the isolated probe layout.

The identity/scope comparisons can be reproduced from the pinned review checkout:

```bash
git -C /tmp/keyflow-pr155-review diff --check 98ee0202499ba87fa4ee13d58a2a9075016225bd...a597c692fcb102de558dd832d88738c0402f69a2
git -C /tmp/keyflow-pr155-review diff --name-only 98ee0202499ba87fa4ee13d58a2a9075016225bd...a597c692fcb102de558dd832d88738c0402f69a2
git -C /tmp/keyflow-pr155-review diff --exit-code 8987f6db21a839f90c88e33479768d81cef508e9 a597c692fcb102de558dd832d88738c0402f69a2 -- apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts apps/server/src/modules/key-cortex/__tests__/key-cortex-query-pipeline.service.spec.ts scripts/proof-admission/manifests/auth-fail-closed-001-negative-controls.json
git -C /tmp/keyflow-pr155-review diff --exit-code fe79181638e373584c3ca3184a39343a132040cd a597c692fcb102de558dd832d88738c0402f69a2 -- apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts apps/server/src/modules/key-cortex/__tests__/key-cortex-query-pipeline.service.spec.ts scripts/proof-admission/manifests/auth-fail-closed-001-negative-controls.json
```

## Evidence export

Export only these five files: `README.md`, `review-summary.json`, and the three JSON evidence reports listed above. Exclude `deps/`, `repo/`, `node_modules/`, generated clients, build outputs and transient logs. The isolated dependency tree remains available for the parent review's separate probes.

Packaging did not rerun tests, change implementation, or perform any remote mutation.
