import { CANON, GROUPS, PHRASES, ROLE_EXTRA_ALIASES, ROLE_IDS, ROLES } from "./roles.mjs";

export { CANON, GROUPS, PHRASES, ROLE_EXTRA_ALIASES, ROLE_IDS, ROLES };

export const PROFILE_KEY = "rjf.profile.v1";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&", "<": "<", ">": ">", '"': "\u0026quot;" })[c]);

const CANON_MAP = new Map(CANON);
const canon = (w) => CANON_MAP.get(w) ?? w;

const STOP = new Set(
  (
    "the and for with that this from are was were you your not but all any can will would have has had one two three new per via etc plus " +
    "work working works job jobs remote role roles position positions looking want need like love hate am i we us it by of to in on at as is be no so do " +
    "about into over out up up our their his her its who what when where why how team teams company companies time full part experienced experience " +
    "ii iii iv senior junior staff principal lead leading"
  ).split(" "),
);

export function terms(text) {
  let s = ` ${String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
  for (const [phrase, to] of PHRASES) {
    s = s.split(` ${phrase} `).join(` ${to} `);
  }
  return new Set(
    s
      .split(" ")
      .map(canon)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

// Same order as ROLES; test/roles.test.mjs keeps this and scripts/roles.json honest.
const ROLE_TERMS = new Map(ROLES.map((label, i) => [ROLE_IDS[i], terms(label)]));

export const labelKey = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const ROLE_BY_LABEL = new Map([
  ...ROLES.flatMap((label, i) => {
    const id = ROLE_IDS[i];
    const parts = label
      .split(/[/ ,]+/)
      .map(labelKey)
      .filter(Boolean);
    return [[labelKey(label), id], [labelKey(id), id], ...parts.map((p) => [p, id])];
  }),
  ...ROLE_EXTRA_ALIASES.flatMap(([id, aliases]) => aliases.map((a) => [labelKey(a), id])),
]);

const ROLE_LABEL_TERMS = new Map(ROLE_IDS.map((id, i) => [id, terms(ROLES[i])]));
const ROLE_BONUS = 1.5;

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
  for (const [weight, set] of fieldSets(job)) {
    for (const t of profileTerms) {
      if (set.has(t)) score += weight;
    }
  }
  const roleTerms = job.role && ROLE_TERMS.get(job.role);
  if (roleTerms && [...profileTerms].some((t) => roleTerms.has(t))) {
    score += ROLE_BONUS;
  }
  return score / profileTerms.size;
}

// Role filter: match any of the selected roles (SQL `IN`).
export function roleMatcher(roles) {
  const roleIds = new Set();
  if (roles) {
    const list = Array.isArray(roles) || roles instanceof Set ? roles : String(roles).split(",");
    for (const entry of list) {
      const value = String(entry).trim();
      if (!value) continue;
      const id = ROLE_BY_LABEL.get(labelKey(value));
      if (id) roleIds.add(id);
      else if (ROLE_IDS.includes(value)) roleIds.add(value);
    }
  }
  if (!roleIds.size) return () => true;
  return (job) => {
    const titleTerms = terms(job.title);
    const byRole = Boolean(job.role) && roleIds.has(job.role);
    const byTitle = [...roleIds].some((id) => [...ROLE_LABEL_TERMS.get(id)].every((t) => titleTerms.has(t)));
    return Boolean(byRole || byTitle);
  };
}

// Profile as a filter: selected roles are one condition (OR inside, SQL `IN`), free-text entries are additional conditions (all must match).
export function profileMatcher(profileText) {
  const cleaned = String(profileText ?? "").replace(/^\s*your preferences[^:]*:\s*/i, "");
  const roleIds = new Set();
  const textTerms = [];
  for (const entry of cleaned.split(",")) {
    const value = entry.trim();
    if (!value) continue;
    const id = ROLE_BY_LABEL.get(labelKey(value));
    if (id) roleIds.add(id);
    else textTerms.push(...terms(value));
  }
  if (!roleIds.size && !textTerms.length) return () => true;
  const roleCheck = roleMatcher(roleIds);
  return (job) => {
    if (roleIds.size && !roleCheck(job)) return false;
    if (textTerms.length) {
      const present = new Set(fieldSets(job).flatMap(([, set]) => [...set]));
      if (!textTerms.every((t) => present.has(t))) return false;
    }
    return true;
  };
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

const within1 = (a, b) => {
  if (a === b) return true;
  const [s, t] = a.length <= b.length ? [a, b] : [b, a];
  if (t.length - s.length > 1) return false;
  let i = 0;
  while (i < s.length && s[i] === t[i]) i++;
  if (i === s.length) return true;
  if (s.length === t.length) {
    return (
      s.slice(i + 1) === t.slice(i + 1) || (s[i] === t[i + 1] && s[i + 1] === t[i] && s.slice(i + 2) === t.slice(i + 2))
    );
  }
  return s.slice(i) === t.slice(i + 1);
};

const MIN_FUZZY = 5;
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

const scoreTokens = (wanted, job) => {
  if (!wanted.length) return 0;
  let total = 0;
  for (const t of wanted) {
    let best = 0;
    for (const [weight, hay] of searchFields(job)) {
      if (weight > best && hay.some((w) => tokenHit(t, w))) best = weight;
    }
    if (!best) return 0;
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
