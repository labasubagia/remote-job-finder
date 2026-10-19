// Profile-based ranking. Pure functions, no dependencies, shared by the page and the tests.
// Zero setup for the visitor: nothing is downloaded, no key, no network call.

export const PROFILE_KEY = "rjf.profile.v1";

// First entry is the canonical form; the rest are aliases that must fold into it.
const GROUPS = [
  ["engineer", "developer", "programmer", "dev"],
  ["frontend", "front end", "react", "vue", "ui"],
  ["backend", "back end", "server", "api"],
  ["fullstack", "full stack"],
  ["mobile", "ios", "android", "react native"],
  ["ml", "machine learning", "deep learning"],
  ["ai", "artificial intelligence", "llm"],
  ["data", "data science", "data scientist", "analytics", "analyst"],
  ["devops", "sre", "infra", "infrastructure", "platform", "cloud"],
  ["security", "infosec", "appsec"],
  ["qa", "quality assurance", "tester", "testing"],
  ["designer", "design", "ux", "graphic"],
  ["pm", "product manager", "product owner", "project manager"],
  ["manager", "lead", "head", "director", "vp"],
  ["hr", "people operations", "recruiter", "recruiting", "talent"],
  ["support", "customer support", "customer success", "helpdesk"],
  ["marketing", "growth", "seo", "content"],
  ["finance", "accounting", "accountant"],
  ["writer", "copywriter", "editor"],
];

const CANON = new Map();
for (const [canon, ...aliases] of GROUPS) for (const w of [canon, ...aliases]) CANON.set(w, canon);

// Multi-word aliases first, longest first, so "customer support" is not eaten by "support" alone.
const PHRASES = [...CANON.keys()]
  .filter((w) => w.includes(" "))
  .sort((a, b) => b.length - a.length)
  .map((w) => [w, CANON.get(w)]);

const canon = (w) => CANON.get(w) ?? w;

// Words that carry no signal in either a profile or a job text.
const STOP = new Set(
  (
    "the and for with that this from are was were you your not but all any can will would have has had one two three new per via etc plus " +
    "work working works job jobs remote role roles position positions looking want need like love hate am i we us it by of to in on at as is be no so do " +
    "about into over out up our their his her its who what when where why how team teams company companies time full part experienced experience " +
    "ii iii iv senior junior staff principal lead leading"
  ).split(" "),
);

export function terms(text) {
  let s = ` ${String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
  for (const [phrase, to] of PHRASES) s = s.split(` ${phrase} `).join(` ${to} `);
  return new Set(
    s
      .split(" ")
      .map(canon)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

// Weight per field: a hit in the title matters most, a hit in the excerpt least.
const FIELDS = [
  [3, (j) => j.title],
  [2, (j) => (j.tags || []).join(" ")],
  [1, (j) => j.excerpt],
];

const sets = new WeakMap();
const fieldSets = (job) => {
  let s = sets.get(job);
  if (!s) {
    s = FIELDS.map(([w, get]) => [w, terms(get(job))]);
    sets.set(job, s);
  }
  return s;
};

export function scoreJob(profileTerms, job) {
  if (!profileTerms.size) return 0;
  let score = 0;
  for (const [weight, set] of fieldSets(job)) for (const t of profileTerms) if (set.has(t)) score += weight;
  return score / profileTerms.size;
}

export function matchedTerms(profileTerms, job) {
  const inJob = new Set(fieldSets(job).flatMap(([, set]) => [...set]));
  return [...profileTerms].filter((t) => inJob.has(t));
}

// --- Search box: typo-tolerant, literal (no alias folding); every query token must hit a job word. ---

const words = (text) =>
  String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length > 1);

// True when a and b differ by at most one insertion, deletion, substitution or transposition.
const within1 = (a, b) => {
  if (a === b) return true;
  const [s, t] = a.length <= b.length ? [a, b] : [b, a];
  if (t.length - s.length > 1) return false;
  let i = 0;
  while (i < s.length && s[i] === t[i]) i++;
  if (i === s.length) return true; // s is a prefix of t
  if (s.length === t.length) {
    return (
      s.slice(i + 1) === t.slice(i + 1) || // substitution
      (s[i] === t[i + 1] && s[i + 1] === t[i] && s.slice(i + 2) === t.slice(i + 2)) // transposition
    );
  }
  return s.slice(i) === t.slice(i + 1); // one extra char in t
};

const MIN_FUZZY = 5;

// Prefix-style rules only, never a blind substring test: "react" must not match "inte(ract)ion".
const tokenHit = (q, word) => word === q || word.startsWith(q) || (q.length >= MIN_FUZZY && within1(q, word));

const SEARCH_FIELDS = [
  [3, (j) => j.title],
  [2, (j) => (j.tags || []).join(" ")],
  [1, (j) => j.company],
  [1, (j) => j.excerpt],
];

const searchSets = new WeakMap();
const searchFields = (job) => {
  let s = searchSets.get(job);
  if (!s) {
    s = SEARCH_FIELDS.map(([weight, get]) => [weight, words(get(job))]);
    searchSets.set(job, s);
  }
  return s;
};

// Sum of the best field weight per query token; 0 means the job does not match.
const scoreTokens = (wanted, job) => {
  if (!wanted.length) return 0;
  let total = 0;
  for (const t of wanted) {
    let best = 0;
    for (const [weight, hay] of searchFields(job)) {
      if (weight > best && hay.some((w) => tokenHit(t, w))) best = weight;
    }
    if (!best) return 0; // every token has to match somewhere
    total += best;
  }
  return total;
};

export function searchTokens(query) {
  return [...new Set(words(query))];
}

export function searchScore(query, job) {
  return scoreTokens(searchTokens(query), job);
}

export function jobMatches(query, job) {
  const wanted = searchTokens(query);
  return !wanted.length || scoreTokens(wanted, job) > 0;
}

// Recommended: profile score desc, then newest. No profile: pure recency (same as Newest).
export function rankJobs(jobs, profileText) {
  const profileTerms = terms(profileText);
  const newest = (a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt);
  const scored = jobs.map((job) => ({ job, score: scoreJob(profileTerms, job) }));
  scored.sort((a, b) => b.score - a.score || newest(a.job, b.job));
  return scored;
}
