> **Review identity:** this is a separate ChatGPT subagent’s source/evidence check of root’s runner correction. It is useful peer verification, not independent cross-model admission or an F9 implementation verdict. The evidence remains in a draft documentation PR.

# Independent review: F9 evidence-runner correction

Verdict: **PASS at the declared evidence-runner scope. No substantive correction required.** This is a source/artifact review of the local runner correction, not F9 implementation acceptance, a production result, a merge grant or Windows runtime validation.

## Reviewed bytes

- Corrected runner: `docs/intelligence/sessions/2026-10-17-worker-review-followthrough/proof/run-f9-cli-probe-portable.mjs`, SHA256 `17e4137134fc0215b8f0b5365d18d8e9985167f53ea002d92520d1fb21401fa8`.
- Frozen original: `2026-10-17-p0-safety-review/f9/run-cli-probe.mjs`, SHA256 `d64babe09abb58b4668d91903f0b9f3367f538f04491543a1fb240c0c95db919`.
- Shared config: SHA256 `60cf3efac4430b374a0a8b0bf67bcba9edc4ad50c540706fef8ae64a244a4969`.
- Unchanged network fixture: SHA256 `553d7ade3a10395b7766f9dab184ed9ea0675d9acb4b42664e8f01909b5827e5`.
- Source checkout HEAD independently resolved to `98ee0202499ba87fa4ee13d58a2a9075016225bd`; all 12 source-manifest SHA256 entries matched the inspected bytes.

## Findings

1. **Preload URL correction is appropriate.** Corrected line 10 supplies the fixture's file URL `.href` to `--import`, retaining the `file:` scheme and URL encoding. The original converts the URL back to an OS path, which is fragile for Windows drive-letter paths and URL-significant path characters. The corrected import still points to the same frozen fixture/config. Preload failure stops startup before the source CLI executes.
2. **Environment inheritance stays bounded.** Lines 15–29 preserve only PATH, SYSTEMROOT, WINDIR, PATHEXT, TEMP and TMP, matched case-insensitively, and then set explicit F9 paths plus synthetic GitHub token/repository/PR values. Real GitHub credentials, NODE_OPTIONS, shell startup variables and arbitrary parent environment values are not forwarded. PATH now survives into the synthetic child, so the unchanged config can find git outside the original POSIX fallback paths. This does not broaden the CLI's repository or token scope.
3. **The inspected execution remains local.** Config lines 23–39 resolve local paths, check the exact source commit and hash every manifest source; its git operation is read-only `rev-parse`. Fixture lines 19–32 replace global fetch before the pinned CLI runs, serve only in-memory responses and throw on unexpected targets without forwarding. The pinned CLI's API helper uses that global fetch; its inspected import closure introduces no alternative networking call. The only PUT is the fixture's mock merge response. This is a guarantee for the inspected pinned code/fixture, not a general OS network sandbox.
4. **Defect reproduction is unchanged.** Assertions still require eligibility, exactly two PR snapshots, one mocked PUT and no `/issues/80` request. The copied summary fields retain the synthetic ACCEPT_FOR_ADMISSION / false merge-authority setup. Using `config.sourceMain` instead of repeating a literal is consistent with the config's exact-source assertion. Added runner/runtime metadata and the terminal newline do not change the tested behavior.

## Verification and limits

I independently compared the recorded original and corrected runs under `/tmp/kf-f9-cli-portability-20261017/`: their complete request traces and parsed source-CLI results are equal. Each contains 14 mocked GETs, two full PR snapshots and one mocked merge PUT. The corrected summary records Node v20.18.1, Linux x64; the parent reports the original ran on the same runtime. The original summary itself has no runtime metadata.

No new probe execution or expanded tests were performed for this review. Windows was not run; the `.href` change removes the identified specifier problem, but this review does not certify the entire unchanged config/git-launch chain on Windows. No source, fixture, manifest, runtime or shared-checkout file was changed by this reviewer.
