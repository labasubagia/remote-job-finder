# remote-job-finder

A remote-only job board with a personalisation box: describe what you want ("backend Go, no on-call", "HR", or a typo like "desgin") and the list reorders around it.

Live: <https://labasubagia.github.io/remote-job-finder/>

Zero runtime dependencies. The page ships `index.html` plus two ES modules (`app.mjs`, `search.mjs`) and one generated JSON; everything ranking-related runs in the browser.

## What visitors get

- **Preference box + 10 role chips** — free text, e.g. `software engineer`, `data scientist`, `HR / recruiter`, combined with commas. The profile is remembered in `localStorage` under `rjf.profile.v1` (wrapped in try/catch, so private mode still works, it just forgets).
- **Profile filter, AND across conditions** — the profile narrows the list. Selected role chips are one condition (match any of them, SQL `IN`), every free-text entry is another condition (all must match). A role matches the classified `role`, or the title when the classifier left the job unlabelled, so unclassified postings stay reachable.
- **Search box** — `title`, `tags`, `company` and `excerpt` are searched, typos included (`enigneer`, `desgin`, `softw` all hit), and it combines with the profile filter. While a query is active, results are ordered by relevance instead of recency, unless `Newest` is selected.
- **Sort** — `Best match` (profile order within the filtered set) or `Newest` (recency within the same set); a source filter narrows to one feed.

## Data

`scripts/fetch-jobs.mjs` aggregates five public feeds: remoteok, remotive, arbeitnow, himalayas, wwr.

- 30-day freshness window, excerpt truncated to 200 chars, at most 8 tags per job, deduplicated by id, sorted newest first.
- 3 attempts with a 20 s timeout per request; retryable HTTP statuses (408, 425, 429, 5xx) are retried, HTML entities (named, decimal and hex) and CDATA are decoded.
- Timestamps are accepted as epoch seconds, epoch milliseconds, ISO or RFC-822; anything unparseable or out of range becomes `null` and the row is dropped. Excerpts are cut on code-point boundaries. Jobs whose `url` is not `http(s)` are dropped, never published.
- A source returning **zero** fresh jobs throws `FatalSourceError` and turns the Actions run red — a stale feed fails loudly instead of publishing a silently shrinking board.
- `site/jobs.json` is generated, gitignored, and only ever deployed as a Pages artifact.
- **Roles** are classified after fetching, in the Actions runner only: `scripts/classify-roles.py` runs a CPU Laya checkpoint behind the System One contract and keeps an answer only when confidence is at least 0.7 and the answer is not `other`. The role is written as `role` + `roleConfidence`; a job without a confident answer stays role-less and ranks by text. Results are reused by `id` + title + company from the previous run, so the daily job classifies only new postings.

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

Node >= 22 (CI runs 24). `npm run fetch` hits the real feeds; most of them send no CORS headers, which is exactly why fetching runs on a runner and never in the browser.

## Code map

| Path | Role |
| --- | --- |
| `scripts/fetch-jobs.mjs` | Aggregator: source definitions, retries, normalisation to `{id,title,company,url,source,tags,postedAt,excerpt,location,timezoneOffsets}` |
| `scripts/timezone.mjs` | Resolves a free-text location to UTC offsets from Node's own ICU data (`Intl`): IANA city names, country names, US states, zone abbreviations. Build-time only, no data files |
| `scripts/roles.json` | Role taxonomy, model revision and confidence threshold; shared by the classifier, the merge step and the tests |
| `scripts/roles.mjs` | Pure gating/merge logic: `samePosting`, `pickRole`, `resolveRole`, `applyRoles` |
| `scripts/classify-roles.py` | Build-time only: predicts roles for postings missing from the previous run |
| `scripts/apply-roles.mjs` | Merges cached and fresh predictions into `jobs.json`, then saves the merged list for the cache |
| `site/index.html` | The page: styles and markup; loads the app module through a single `<script type="module">` import |
| `site/app.mjs` | DOM side: `init()` plus the state, rendering and event wiring |
| `site/search.mjs` | Pure logic, no DOM: `terms`, `scoreJob`, `profileMatcher`, `matchedTerms`, `rankJobs`, `searchTokens`, `searchScore`, `jobMatches`, `ROLES`, `ROLE_IDS`, `ROLE_BY_LABEL`, `labelKey`, `PROFILE_KEY`, `esc`; a matching classified role adds a fixed bonus |
| `test/*.test.mjs` | `node:test` suites (67 tests) covering the scripts, both modules, and the filter UI through a DOM stub |
| `biome.json` | Formatter + linter config (line width 120, organised imports) |

Ranking and search scoring:

- Profile terms: aliases fold into a canonical form (`front end` -> `frontend`, `people operations` -> `hr`, `machine learning` -> `ml`, `sre` -> `devops`), stopwords are dropped, then matches are weighted per field: title 3, tags 2, excerpt 1. Filtering is stricter than scoring: comma-separated entries combine with AND, role chips are one `IN` condition matched by classified role or title, and scoring still sums every hit.
- Search: every query token has to hit some word; fields are weighted title 3, tags 2, company 1, excerpt 1, and the per-token best weights are summed into a relevance score. A word matches on exact, prefix, or one edit away (insert/delete/substitute/transpose) for tokens of 5+ characters.
- Deliberately not done: abbreviation expansion in the search box (`sre` finds nothing there, while the profile box folds it), negation ("no on-call"), seniority filters, multi-language profiles.
- Classified roles: a job whose `role` shares a term with the profile gets a fixed 1.5 bonus before the profile-size normalisation. Jobs without a confident role are unaffected.

## Geography filter

- `scripts/timezone.mjs` turns each job's free-text `location` into UTC offsets at build time, reading ICU's tz database through `Intl` instead of shipping a city list: `Copenhagen` -> `[2]`, `Vancouver` -> `[-7]`, `United States` -> `[-10..-5]`, `Kansas` -> `[-6,-5]`, `NYC or Remote (EST or CST)` -> `[-6,-5]`.
- The browser only compares numbers. "My timezone" keeps a job when any of its offsets is within the tolerance of the reader's clock.
- A label that names no place (`Remote`, `Worldwide`, a company name) or a town ICU does not know stays visible: roughly 2% of the feed. Guessing those away would hide takeable jobs, which is worse than showing a doubtful one.
- The regional dropdowns use fixed bands: Americas -10..-3, EMEA -1..+4, APAC +5..+12. They intentionally differ from a tolerance window: a region is a place, not a distance.

## Automation

- `.github/workflows/jobs.yml` — daily at `17 6 * * *`, on `workflow_dispatch`, and on every push to `main`: tests, fetch, role classification, deploy to Pages. The classifier's wheels (uv cache), weights (Hugging Face cache) and previous results are cached; a classifier failure degrades to keyword ranking instead of blocking the deploy.
- `.github/workflows/ci.yml` — on every pull request: `npm ci`, `npm run fmt:check`, `npm run lint`, `npm test`.
- `main` is protected, so changes land through pull requests only.
- Husky hooks: `pre-commit` runs `biome check --staged` (fast, check-only: it never rewrites your index), `pre-push` runs `npm run check`.
