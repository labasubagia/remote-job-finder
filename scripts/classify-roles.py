#!/usr/bin/env python3
"""Classify new job postings with the Laya checkpoint behind the System One wire format.

Only postings that are missing from the previous run's file are predicted; everything
else is reused by apply-roles.mjs. Writes one JSON object per job id, never the site file.
"""
import argparse
import json
import os
import sys
from pathlib import Path

CONFIG = json.loads(Path(__file__).with_name("roles.json").read_text())
ROLES = CONFIG["roles"]
THRESHOLD = CONFIG["threshold"]


def same_posting(job, previous):
    return (
        previous is not None
        and previous.get("id") == job.get("id")
        and previous.get("title") == job.get("title")
        and previous.get("company") == job.get("company")
    )


def state(job):
    tags = ", ".join(str(t) for t in job.get("tags") or [])
    return f"Job title: {job.get('title') or ''}\nCompany: {job.get('company') or ''}\nTags: {tags}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--jobs", default=os.environ.get("RJF_JOBS_PATH", "site/jobs.json"))
    parser.add_argument("--previous", default=os.environ.get("RJF_PREVIOUS_PATH", ".cache/previous-jobs.json"))
    parser.add_argument("--out", default=os.environ.get("RJF_PREDICTIONS_PATH", ".cache/role-predictions.json"))
    args = parser.parse_args()
    try:
        jobs = json.loads(Path(args.jobs).read_text())
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"roles: failed to read jobs from {args.jobs}: {e}", file=sys.stderr)
        sys.exit(1)
    if not isinstance(jobs, list):
        print(f"roles: expected JSON array in {args.jobs}", file=sys.stderr)
        sys.exit(1)
    previous = {}
    if Path(args.previous).exists():
        try:
            prev_data = json.loads(Path(args.previous).read_text())
            if isinstance(prev_data, list):
                for job in prev_data:
                    if isinstance(job, dict):
                        jid = job.get("id")
                        if isinstance(jid, str):
                            previous[jid] = job
        except (json.JSONDecodeError, OSError):
            pass
    missing = [job for job in jobs if isinstance(job, dict) and not same_posting(job, previous.get(job.get("id")))]
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if not missing:
        out.write_text("{}")
        print(f"roles: 0 new of {len(jobs)} jobs, model not loaded")
        return
    import laya  # deferred: a cache hit must not pay for torch or the model

    token = os.environ.get("HF_TOKEN") or None
    agent = laya.load(CONFIG["model"], revision=CONFIG["revision"], token=token)
    criteria = {role["id"]: role.get("criteria", role["label"]) for role in ROLES}
    questions = {
        "role": {
            "type": "choice",
            "instructions": "Which role category best describes this job posting? Pick one.",
            "criteria": criteria,
        }
    }

    predictions = {}
    for index, job in enumerate(missing, 1):
        if not isinstance(job, dict):
            continue
        jid = job.get("id")
        if not isinstance(jid, str):
            continue
        answer = agent.predict(state(job), questions, min_confidence=THRESHOLD)["answers"]["role"]
        predictions[jid] = {
            "role": answer["choice"],
            "confidence": answer["answer_confidence"],
            "abstained": answer.get("abstention") == "abstained" or bool(answer.get("low_confidence")),
        }
        if index % 10 == 0 or index == len(missing):
            out.write_text(json.dumps(predictions, ensure_ascii=False))
            print(f"roles: {index}/{len(missing)} predicted", file=sys.stderr, flush=True)

    out.write_text(json.dumps(predictions, ensure_ascii=False))
    print(f"roles: {len(missing)} of {len(jobs)} jobs predicted, threshold {THRESHOLD}")

if __name__ == "__main__":
    main()
