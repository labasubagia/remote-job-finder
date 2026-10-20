# AGENTS.md

Agent guide for this repo. Required flow, in order: **code → run → test → branch → PR → review/refactor → merge → monitor**.

Hard rules:

- `main` is protected. **Never** `git push` to `main` or `git commit` directly on `main`. Every change lands through a pull request.
- Every GitHub interaction uses GitHub CLI (`gh`) — not `curl`, not a hand-rolled token, not the web UI for actions (read-only `gh pr view --web` is fine).
- Generated or machine-produced output is not source. Keep it out of git, never edit it by hand, and ship it only as a deploy artifact (in this repo the generated `jobs.json`).
- Zero runtime dependencies. Do not add a dependency to the page (`site/`). `devDependencies` changes need human approval.
- Stack: plain HTML + ES modules in the browser, Node >= 22 (CI runs 24), `node --test`, biome 2.5. Biome does **not** process Markdown, so `biome check` proves nothing about `.md` files.
- Do not leave scratch scripts, logs, or fixtures untracked: delete them before opening a PR. Ignored paths are dependencies and generated output only — there is no `.env` entry, so no credential file belongs in this tree; `gh` auth stays in its own config.

## 1. Code

Read `README.md` first: it owns the code map and the behaviour notes. Do not copy that map here — this file must stay true while files move, split, or get renamed.

- Respect the module boundary that already exists: pure, DOM-free logic that `node --test` can drive lives apart from the module that touches `document`; markup and styles stay in the HTML shell. Code that needs a browser goes on the DOM side, not into an exported pure helper.
- Reuse before adding: search the tree (`grep -rn`, file listing) for an existing helper, constant, or stub before writing a new one. A new abstraction or module needs a second caller.
- Any exported symbol is public to the repo: before changing or renaming one, find every caller (`grep -rn "<symbol>" site test scripts`) and update them in the same commit.
- Follow the conventions already in force; formatting is not a matter of taste here — biome owns it (ESM, double quotes, semicolons, trailing commas, width 120). Run `npm run fmt` instead of hand-formatting, and never reformat a file just to touch it.
- Zero runtime dependencies in the browser code. A new `devDependency` needs human approval; do not add a library for what the standard library or a few lines already do.
- No magic data in code paths that ship to the browser: derive values at build time (Node/ICU) or from the data already published, and keep generated output out of the source tree.
- If a documented command, path, or behaviour changes, update that README section in the same PR.

## 2. Run

```bash
npm install                                  # once; also installs the husky hooks
npm run fetch                                # writes site/jobs.json (network, real feeds)
python3 -m http.server -d site 8765 --bind 0.0.0.0
# open http://localhost:8765
```

`npm run fetch` hits live feeds and can fail on network trouble; a feed failure is not a code failure — retry once, then report it. Verify the UI for real: load the page, type in the profile box and the search box, confirm the order changes and no job disappears from the list. Tests alone are not proof.

## 3. Test

```bash
npm test        # node --test 'test/**/*.test.mjs'
npm run check   # biome check . && npm test  ← required gate before a PR
npm run fmt     # biome format --write . (only when check rejects formatting)
npm run lint
```

- Bugs: reproduce first, then fix, then prove it through a test or the UI.
- Any behaviour change in ranking or search ships with a test in `test/` that failed before the fix and passes after it.
- Never pin tests to documentation wording or incidental details.
- Hooks already exist: `pre-commit` runs `biome check --staged` (check-only, it never rewrites the index), `pre-push` runs `npm run check`. Do not bypass them with `--no-verify`.
- UI tests run under `node --test` with hand-rolled DOM stubs already in the suite. Extend those stubs; never add jsdom or any other DOM dependency.

## 4. Branch

Always from a fresh `main`:

```bash
git switch main
git pull --ff-only origin main
git switch -c feat/<short>       # or fix/<short>, chore/<short>, docs/<short>
```

One branch = one logical change. When that change is really several small tasks, commit each task separately — one task, one self-contained commit, imperative subject (`fix: drop job with non-http url`, `feat: timezone tolerance of ±2 hours`). Keep the history readable as a task list: no "wip", no mixed commit that touches two unrelated tasks, no folding a later fix into an earlier commit. Do not mix a large refactor with a behaviour change.

## 5. PR

```bash
git push -u origin HEAD
gh pr create --base main --title "<title>" --body-file <summary-file>
gh pr view --web     # optional
```

Body must cover: summary, rationale, the verification commands already run (`npm run check`, manual UI check), and risks. Never open a PR from a branch that has not passed `npm run check`.

- Confirm the CLI is authenticated first (`gh auth status`). Write the body to a file and use `--body-file`: a non-TTY session hangs on `--body` with a trailing editor prompt.

## 6. Review / Refactor

```bash
gh pr checks --watch                 # wait for CI (fmt:check, lint, test)
gh pr view --comments
gh pr diff
gh pr checks --required             # compact status of required checks
```

Review before asking a human:

- Read `gh pr diff` as a reviewer: delete dead code, scaffolding, and abstractions with no second caller.
- Fix with follow-up commits on the same branch, then `git push`. Never `--force` a branch that is under review or has comments; if the branch is yours and unreviewed, prefer `gh pr edit` or a normal push over rewriting.
- Human review comments: reply in the thread (`gh api` only when `gh pr` has no subcommand for it), then resolve the thread.
- Red CI: read the log (`gh run view <run-id> --log-failed`), fix the root cause, never weaken a test or a lint rule.

## 7. Merge

```bash
gh pr checks --required             # must be green
gh pr merge --squash --delete-branch \
  --subject "<type>: <summary>" \
  --body-file <summary-file>        # summary of every commit in the PR
git switch main && git pull --ff-only origin main
```

Always squash merge: the PR lands as exactly one commit on `main`, no matter how many task commits the branch carries. Never `--merge` or `--rebase` — the per-task commits are for review, the squashed commit is the record.

- The squash subject follows the repo convention (`fix:`, `feat:`, `chore:`, `docs:`) and names the overall change, not the last task.
- The squash body summarizes **all** changes in the PR: one line per task commit, plus the verification that ran. Do not reuse the last commit message as the body.
- The same summary belongs in the PR body (`gh pr edit --body-file`), so the merged commit and the PR read identically.
- Never merge while a required check is not green, while a comment is unanswered, or while the diff carries unrelated changes. Never merge someone else's PR without human approval.

## 8. Monitor (GitHub)

Monitor means: watch the GitHub state of **the branch and PR you are working on** — CI results, merge conflicts, failed checks, review requests. It is not a post-merge ritual.

```bash
gh pr status                                   # your PR, review state, CI rollup
gh pr checks --watch                           # wait for every check on this PR
gh pr checks                                   # re-check after pushing a fix
gh pr view --json number,state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup
gh pr view --json files --jq '.files[].path'   # scope of the diff
gh run list --branch "$(git branch --show-current)" --limit 5
gh run view <run-id> --log-failed              # only the failing steps
gh run rerun <run-id> --failed                 # after fixing the cause, never blind
```

Read the results like this, and act before asking anyone:

| Signal | Meaning | Action |
| --- | --- | --- |
| `mergeable: CONFLICTING` or `mergeStateStatus: DIRTY` | conflict with `main` | `git switch main && git pull --ff-only origin main`, `git switch -`, `git rebase main`, resolve, `git push` |
| `mergeStateStatus: BEHIND` | branch is out of date | rebase onto `main` and push |
| failing check in `gh pr checks` | CI red | `gh run view <run-id> --log-failed`, fix the cause locally, rerun `npm run check`, push |
| `reviewDecision: REVIEW_REQUIRED` | waiting on a human | request review (`gh pr edit --add-reviewer <user>`), do not merge |
| `reviewDecision: CHANGES_REQUESTED` | unresolved comments | address each thread, reply, push |
| no check reported for the branch | expected before a PR exists (CI runs on `pull_request`, not on a plain branch push); otherwise the workflow did not trigger | before the PR: nothing to do; after: `gh run list --branch <branch>`, inspect `ci.yml` filters, report instead of merging |

Rules:

- Re-run monitoring after every push: checks, `mergeable`, and review state all change.
- Fix forward with commits on the branch; never `--force` a branch under review.
- A red run is a failure to investigate, not to rerun. Read `--log-failed` first.
- The pull-request workflow is the gate on this branch (`npm ci`, `npm run fmt:check`, `npm run lint`, `npm test`). The scheduled/deploy workflow on `main` only matters here when your change touches the build scripts or the workflow files themselves.
- After merge, confirm the deploy run on `main` succeeded and the live site serves the new data.
