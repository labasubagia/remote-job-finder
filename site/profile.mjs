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
  ("the and for with that this from are was were you your not but all any can will would have has had one two three new per via etc plus " +
    "work working works job jobs remote role roles position positions looking want need like love hate am i we us it by of to in on at as is be no so do " +
    "about into over out up our their his her its who what when where why how team teams company companies time full part experienced experience " +
    "ii iii iv senior junior staff principal lead leading").split(" "),
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
  if (!s) sets.set(job, (s = FIELDS.map(([w, get]) => [w, terms(get(job))])));
  return s;
};

export function scoreJob(profileTerms, job) {
  if (!profileTerms.size) return 0;
  let score = 0;
  for (const [weight, set] of fieldSets(job))
    for (const t of profileTerms) if (set.has(t)) score += weight;
  return score / profileTerms.size;
}

export function matchedTerms(profileTerms, job) {
  const inJob = new Set(fieldSets(job).flatMap(([, set]) => [...set]));
  return [...profileTerms].filter((t) => inJob.has(t));
}

// Recommended: profile score desc, then newest. No profile: pure recency (same as Newest).
export function rankJobs(jobs, profileText) {
  const profileTerms = terms(profileText);
  const newest = (a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt);
  const scored = jobs.map((job) => ({ job, score: scoreJob(profileTerms, job) }));
  scored.sort((a, b) => b.score - a.score || newest(a.job, b.job));
  return scored;
}
