#!/usr/bin/env python3
"""Replay only into a new result directory; historical proof-summary.json is immutable."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

PACKAGE = Path(__file__).resolve().parent

def require(ok, reason):
    if not ok:
        raise ValueError(reason)

def sha256(data):
    return hashlib.sha256(data).hexdigest()

def blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def verify(work, manifest, historical):
    expected = {item["path"]: item for item in historical["changed_files"]}
    changed = []
    for item in manifest["files"]:
        before = (work / "baseline" / item["path"]).read_bytes()
        after = (work / "candidate" / item["path"]).read_bytes()
        require((len(before), blob(before), sha256(before)) ==
                (item["size"], item["sha"], item["sha256"]), "baseline mismatch: " + item["path"])
        if before != after:
            changed.append(item["path"])
            require(item["path"] in expected, "unexpected candidate change")
            entry = expected[item["path"]]
            require(blob(after) == entry["after_git_blob"] and sha256(after) == entry["after_sha256"],
                    "candidate mismatch: " + item["path"])
    require(set(changed) == set(expected), "candidate must differ in exactly three files")
    return changed

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--results-dir", type=Path, required=True, help="Must be absent and outside the publication package")
    parser.add_argument("--mode", choices=["smoke","full"], default="smoke")
    args = parser.parse_args()
    work, output = args.work_dir.resolve(), args.results_dir.resolve()
    require(not output.exists(), "result directory must not exist; historical results are never overwritten")
    require(not output.is_relative_to(PACKAGE), "results must be outside the publication package")
    manifest_bytes = (PACKAGE / "source-manifest.json").read_bytes()
    historical_bytes = (PACKAGE / "proof-summary.json").read_bytes()
    manifest, historical = json.loads(manifest_bytes), json.loads(historical_bytes)
    require(len(manifest["files"]) == 39 and manifest["artifact"] == historical["artifact"], "source manifest mismatch")
    changed = verify(work, manifest, historical)
    node = shutil.which("node")
    require(node is not None, "Node.js is required")
    # No HOME, token, NODE_OPTIONS, Git configuration or inherited application credentials.
    env = {key: os.environ[key] for key in ("PATH","SystemRoot","SYSTEMROOT","TEMP","TMP") if key in os.environ}
    version = subprocess.run([node,"--version"],env=env,check=True,capture_output=True,text=True).stdout.strip()
    output.mkdir(parents=True)
    suites = ["scripts/agent-control/tests/admission.spec.mjs",
              "scripts/agent-control/tests/merge-grant.spec.mjs",
              "scripts/agent-control/tests/merge-cli.spec.mjs"]
    if args.mode == "full":
        planned = [
          ("original-suites",work/"baseline",suites,{},1,77,76,1),
          ("new-cli-requirements-on-original-source",work/"candidate",[suites[-1]],{"KF_CLI_ROOT":str(work/"baseline")},1,17,12,5),
          ("candidate-suites",work/"candidate",suites,{},0,84,84,0),
        ]
    else:
        planned = [("candidate-cli-smoke",work/"candidate",[suites[-1]],{},0,17,17,0)]
    runs = []
    for name, cwd, files, extra_env, wanted_exit, wanted_total, wanted_pass, wanted_fail in planned:
        command = [node,"--test","--test-reporter=tap",*files]
        result = subprocess.run(command,cwd=cwd,env={**env,**extra_env},capture_output=True,text=True,timeout=180)
        (output/(name+".tap")).write_text(result.stdout)
        (output/(name+".stderr")).write_text(result.stderr)
        counts = {key:int(value) for key,value in re.findall(r"^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$",result.stdout,re.M)}
        row = {"name":name,"exit_code":result.returncode,"counts":counts,
               "failures":re.findall(r"^not ok \d+ - (.+)$",result.stdout,re.M),
               "tap_sha256":sha256(result.stdout.encode()),"stderr_sha256":sha256(result.stderr.encode())}
        runs.append(row)
        print(json.dumps(row),flush=True)
        require(result.returncode == wanted_exit,name+" unexpected exit; inspect the new result files")
        require(tuple(counts.get(k) for k in ("tests","pass","fail","skipped","cancelled")) ==
                (wanted_total,wanted_pass,wanted_fail,0,0), name+" unexpected test counts")
    independent = []
    for script, name in (("independent-extra-checks.mjs","extra-checks"),
                         ("independent-inline-cli.mjs","inline-cli")):
        destination = output / (name+".json")
        result = subprocess.run([node,str(PACKAGE/script),str(work),str(destination)],env=env,
                                capture_output=True,text=True,timeout=60)
        (output/(name+".stderr")).write_text(result.stderr)
        require(result.returncode == 0,script+" failed: "+result.stderr)
        data = json.loads(destination.read_text())
        independent.append({"name":name,"result":data,"result_sha256":sha256(destination.read_bytes())})
    verify(work,manifest,historical)
    require((PACKAGE/"source-manifest.json").read_bytes() == manifest_bytes,"historical source manifest changed")
    require((PACKAGE/"proof-summary.json").read_bytes() == historical_bytes,"historical proof summary changed")
    summary = {
        "observed_at_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "mode":args.mode,"artifact":manifest["artifact"],"node":version,"platform":os.name,
        "source_files_verified":len(manifest["files"]),"changed_files":changed,
        "historical_proof_summary_sha256":sha256(historical_bytes),
        "historical_proof_unchanged":True,"environment_keys":sorted(env),
        "runs":runs,"independent":independent,"network_requests":0,"real_merges":0,
        "limits":"Node20 hosted, Windows, mutation-control manifest, full-project and eventual published-head proof remain outstanding.",
    }
    (output/"replay-summary.json").write_text(json.dumps(summary,indent=2)+"\n")
    print(json.dumps({"verification":"PASS","mode":args.mode,"historical_proof_unchanged":True,"result_directory":str(output)}))

if __name__ == "__main__":
    main()
