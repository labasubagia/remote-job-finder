# remote-job-finder

A remote-only job board with a personalisation box: describe what you want ("backend Go, no on-call", "HR", or a typo like "desgin") and the list reorders around it.

Live: <https://labasubagia.github.io/remote-job-finder/>

Zero runtime dependencies. The page ships two files (`index.html`, `profile.mjs`) and one generated JSON; everything ranking-related runs in the browser.

## What visitors get

- **Preference box + 10 role chips** — free text, e.g. `software engineer`, `data scientist`, `HR / recruiter`. The profile is remembered in `localStorage` under `rjf.profile.v1` (wrapped in try/catch, so private mode still works, it just forgets).
- **Ranking, never hiding** — matching jobs move up; unrelated jobs stay in the list. Showing "0 of 128" for a vague phrase would be worse than showing an order.
- **Search box** — `title`, `tags`, `company` and `excerpt` are searched, typos included (`enigneer`, `desgin`, `softw` all hit). While a query is active, results are ordered by relevance instead of recency.
- **Sort** — `Best match` (profile order) or `Newest`; a source filter narrows to one feed.

## Data

`scripts/fetch-jobs.mjs` aggregates five public feeds: remoteok, remotive, arbeitnow, himalayas, wwr.

- 30-day freshness window, excerpt truncated to 200 chars, at most 8 tags per job, deduplicated by id, sorted newest first.
- 3 attempts with a 20 s timeout per request; retryable HTTP statuses (408, 425, 429, 5xx) are retried, HTML entities and CDATA are decoded.
- A source returning **zero** fresh jobs throws `FatalSourceError` and turns the Actions run red — a stale feed fails loudly instead of publishing a silently shrinking board.
- `site/jobs.json` is generated, gitignored, and only ever deployed as a Pages artifact.

## Local development

```bash
npm install          # also installs the git hooks (husky)
npm run fetch        # write site/jobs.json (network)
npm run check        # biome fmt + lint, then tests
npm test             # node --test
npm run fmt          # rewrite files with biome
npm run lint
python3 -m http.server -d site 8765 --bind 0.0.0.0   # then open http://localhost:8765
```

Node >= 22 (CI runs 24). `npm run fetch` hits the real feeds; most of them send no CORS headers, which is exactly why fetching runs on a runner and never in the browser.

## Code map

| Path | Role |
| --- | --- |
| `scripts/fetch-jobs.mjs` | Aggregator: source definitions, retries, normalisation to `{id,title,company,url,source,tags,postedAt,excerpt}` |
| `site/index.html` | The page: styles, markup, and the module script that wires state, rendering and events |
| `site/profile.mjs` | Pure logic, no DOM: `terms`, `scoreJob`, `matchedTerms`, `rankJobs`, `searchTokens`, `searchScore`, `jobMatches` |
| `test/*.test.mjs` | `node:test` suites (15 tests) covering both modules |
| `biome.json` | Formatter + linter config (line width 120, organised imports) |

Ranking and search scoring:

- Profile terms: aliases fold into a canonical form (`front end` -> `frontend`, `people operations` -> `hr`, `machine learning` -> `ml`, `sre` -> `devops`), stopwords are dropped, then matches are weighted per field: title 3, tags 2, excerpt 1.
- Search: every query token has to hit some word; fields are weighted title 3, tags 2, company 1, excerpt 1, and the per-token best weights are summed into a relevance score. A word matches on exact, prefix, or one edit away (insert/delete/substitute/transpose) for tokens of 5+ characters.
- Deliberately not done: abbreviation expansion in the search box (`sre` finds nothing there, while the profile box folds it), negation ("no on-call"), seniority and timezone filters, multi-language profiles.

## Automation

- `.github/workflows/jobs.yml` — daily at `17 6 * * *` and on `workflow_dispatch`: tests, fetch, deploy to Pages. There is **no `push` trigger**, so shipping data requires `gh workflow run jobs.yml`.
- `.github/workflows/ci.yml` — on every pull request: `npm ci`, `npm run fmt:check`, `npm run lint`, `npm test`.
- `main` is protected, so changes land through pull requests only.
- Husky hooks: `pre-commit` runs `biome check --staged --write` (fast, auto-fixes and re-stages), `pre-push` runs `npm run check`.
