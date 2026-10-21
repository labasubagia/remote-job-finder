# remote-job-finder

A remote-only job board with a personalisation box: describe what you want ("backend Go, no on-call", "HR", or a typo like "desgin") and the list reorders around it.

Live: <https://labasubagia.github.io/remote-job-finder/>

Zero runtime dependencies. The page ships `index.html` plus two ES modules (`app.mjs`, `search.mjs`) and one generated JSON; everything ranking-related runs in the browser.

## What visitors get

- **Role chips** — categorical filters (e.g., Software engineer, Data scientist, HR / recruiter). Selected chips narrow the list (SQL `IN`, matching classified role or title without leaking noisy tags). Selections persist in `localStorage` (`rjf.profile.v1`), wrapped in try/catch so private mode still works.
- **Search box** — searches `title`, `tags`, `company`, and `excerpt`; typo-tolerant (e.g., "enigneer", "desgin"). Combines with active role filter via `AND`. While a query is active, results order by relevance unless "Newest" is selected.
- **Sort** — "Best match" (relevance or role bonus) or "Newest" (recency). A source filter narrows to one feed.
- **Geography filter** — "My timezone" (with tolerance slider), regional dropdowns (Americas / EMEA / APAC), and "Worldwide".
- **Match highlights** — each job shows "match: term1 · term2" badges explaining why it surfaced.
- **Feed source badge** — each job displays its source.
- **Relative timestamps** — e.g., "3 days ago" via `Intl.RelativeTimeFormat`.

## Data

`scripts/fetch-jobs.mjs` aggregates multiple public feeds.

- Freshness window, excerpt length limit, tag cap; deduplicated by id, sorted newest first.
- Retries with timeout; retryable HTTP statuses are retried; HTML entities (named, decimal, hex) and CDATA decoded.
- Timestamps accepted as epoch seconds, epoch milliseconds, ISO, or RFC-822; unparseable/out-of-range becomes `null` and the row is dropped. Excerpts cut on code-point boundaries. Non-http(s) URLs are dropped, never published.
- A source returning zero fresh jobs fails the run loudly (`FatalSourceError`) instead of publishing a silently shrinking board.
- `site/jobs.json` is generated, gitignored, and only deployed as a Pages artifact.
- **Roles** are classified after fetching, in the Actions runner only. A CPU Laya checkpoint runs behind the System One contract; answers below the confidence threshold or labelled `other` are discarded. The role is written as `role` + `roleConfidence`; jobs without a confident answer stay role-less and rank by text. Results are reused by `id` + title + company from the previous run, so the daily job classifies only new postings.

## Local development

```bash
npm install          # also installs the git hooks (husky)
npm run fetch        # write site/jobs.json (network)
npm run check        # biome fmt + lint, then tests
npm test             # node --test
npm run fmt          # rewrite files with biome
npm run lint
python3 -m http.server -d site 8765 --bind 0.0.0.0   # then open http://localhost:8765

# optional: classify roles locally (Python 3.12, ~1 GB model download)
python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements-roles.txt \
  --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple
.venv/bin/python scripts/classify-roles.py && node scripts/apply-roles.mjs
```

Node >= 22 (CI runs 24). `npm run fetch` hits the real feeds; most send no CORS headers, which is why fetching runs on a runner and never in the browser.

## Architecture

| Path | Role |
| --- | --- |
| `scripts/fetch-jobs.mjs` | Aggregator: source definitions, retries, normalisation to a common job shape |
| `scripts/timezone.mjs` | Resolves free-text `location` to UTC offsets from Node's ICU (`Intl`): IANA cities, countries, US states, zone abbreviations. Build-time only, no data files |
| `scripts/roles.json` | Role taxonomy, model revision, confidence threshold — shared by classifier, merge step, tests |
| `scripts/roles.mjs` | Pure gating/merge logic: `samePosting`, `pickRole`, `resolveRole`, `applyRoles` |
| `scripts/classify-roles.py` | Build-time only: predicts roles for postings missing from the previous run |
| `scripts/apply-roles.mjs` | Merges cached and fresh predictions into `jobs.json`, then saves the merged list for the cache |
| `scripts/generate-roles.mjs` | Generates `site/roles.mjs` from `scripts/roles.json` |
| `site/index.html` | The page: styles and markup; loads the app module via `<script type="module">` |
| `site/app.mjs` | DOM side: `init()`, state, rendering, event wiring |
| `site/search.mjs` | Pure logic, no DOM: term extraction, scoring, profile/role matching, ranking, search, `esc` |
| `test/*.test.mjs` | `node:test` suites covering the scripts, both modules, and the filter UI via a DOM stub |
| `biome.json` | Formatter + linter config |

## Role taxonomy

- **Source of truth**: `scripts/roles.json` — canonical role IDs, labels, and alias lists.
- **Generated module**: `site/roles.mjs` — produced by `npm run gen:roles` (`scripts/generate-roles.mjs`). Exports `ROLES`, `ROLE_IDS`, `ROLE_EXTRA_ALIASES` for the browser.
- Any change to roles only requires editing `scripts/roles.json`; running the tests (or `npm run gen:roles`) updates the generated file automatically.

## Ranking and search scoring

- **Profile terms**: aliases fold into a canonical form; stopwords dropped; matches weighted per field (title > tags > excerpt). Filtering is stricter than scoring: comma-separated entries combine with `AND`, role chips are one `IN` condition matched by classified role or title.
- **Search**: every query token must hit some word; fields weighted (title > tags > company > excerpt); per-token best weights summed into a relevance score. A word matches on exact, prefix, or one edit distance for tokens of sufficient length.
- **Classified roles**: a job whose `role` shares a term with the profile gets a fixed bonus before profile-size normalisation. Jobs without a confident role are unaffected.
- **Deliberately not done**: abbreviation expansion in the search box (profile box does it), negation ("no on-call"), seniority filters, multi-language profiles.

## Geography filter

- `scripts/timezone.mjs` turns each job's free-text `location` into UTC offsets at build time via Node's ICU (`Intl`) instead of shipping a city list.
- The browser only compares numbers. "My timezone" keeps a job when any of its offsets is within the tolerance of the reader's clock. Jobs with no resolvable offsets are **kept** (safe default).
- Regional dropdowns (Americas / EMEA / APAC) **hide** jobs with no resolvable offsets. They intentionally differ from a tolerance window: a region is a place, not a distance.
- "Worldwide" matches `worldwide|anywhere|global` in the location text (word boundaries).
- Labels that name no place (`Remote`, `Worldwide`, a company name) or unknown towns stay visible in "My timezone". Guessing those away would hide takeable jobs, which is worse than showing a doubtful one.

## Automation

- `.github/workflows/jobs.yml` — scheduled daily, on `workflow_dispatch`, and on every push to `main`: tests, fetch, role classification, deploy to Pages. Classifier wheels (uv cache), weights (HF cache), and previous results are cached; a classifier failure degrades to keyword ranking instead of blocking the deploy.
- `.github/workflows/ci.yml` — on every pull request: `npm ci`, `npm run fmt:check`, `npm run lint`, `npm test`.
- `main` is protected; changes land through pull requests only.
- Husky hooks: `pre-commit` runs `biome check --staged` (fast, check-only, never rewrites index); `pre-push` runs `npm run check`.