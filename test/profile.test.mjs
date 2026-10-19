import assert from "node:assert/strict";
import { test } from "node:test";
import { jobMatches, matchedTerms, rankJobs, scoreJob, searchScore, terms } from "../site/search.mjs";

const job = (id, title, tags = [], excerpt = "", postedAt = "2026-10-01T00:00:00Z") => ({
  id,
  title,
  tags,
  excerpt,
  postedAt,
  company: "Acme",
  url: `https://example.com/${id}`,
  source: "test",
});

test("terms folds aliases and multi-word phrases into canonical terms", () => {
  assert.ok(terms("Front-End developer").has("frontend"));
  assert.ok(terms("Front-End developer").has("engineer"));
  assert.ok(terms("Machine Learning engineer").has("ml"));
  assert.ok(terms("Customer Support Specialist").has("support"));
  assert.ok(!terms("customer support").has("customer"));
  assert.deepEqual([...terms("   ")], []);
  assert.deepEqual([...terms("a of to")], [], "one/two-letter noise is dropped");
});

test("scoreJob weights title above tags above excerpt", () => {
  const profile = terms("sales");
  const inTitle = job("t", "Sales Manager");
  const inTags = job("g", "Account person", ["sales"]);
  const inExcerpt = job("e", "Ops person", [], "Work with the sales team");
  assert.equal(scoreJob(profile, inTitle), 3);
  assert.equal(scoreJob(profile, inTags), 2);
  assert.equal(scoreJob(profile, inExcerpt), 1);
  assert.equal(scoreJob(new Set(), inTitle), 0, "empty profile scores zero everywhere");
});

test("scoreJob normalises by profile size so long profiles are not auto-winners", () => {
  const one = terms("designer");
  const many = terms("designer copywriter accounting");
  const j = job("d", "Product Designer");
  assert.equal(scoreJob(one, j), 3);
  assert.equal(scoreJob(many, j), 1);
});

test("rankJobs puts profile matches first and breaks ties by recency", () => {
  const jobs = [
    job("hr", "People Operations Manager", ["hr"], "", "2026-10-10T00:00:00Z"),
    job("be", "Backend Engineer (Go)", ["engineer", "go"], "", "2026-10-01T00:00:00Z"),
    job("fe", "Senior Frontend Engineer", ["engineer", "react"], "", "2026-10-05T00:00:00Z"),
  ];
  assert.deepEqual(
    rankJobs(jobs, "backend engineer").map((r) => r.job.id),
    ["be", "fe", "hr"],
  );

  const equal = [
    job("old", "Data Scientist", ["data"], "", "2026-01-01T00:00:00Z"),
    job("new", "Data Scientist", ["data"], "", "2026-10-01T00:00:00Z"),
  ];
  assert.deepEqual(
    rankJobs(equal, "data").map((r) => r.job.id),
    ["new", "old"],
  );
});

test("rankJobs with no profile is pure recency and never reorders the input array", () => {
  const jobs = [
    job("a", "Anything", [], "", "2026-01-01T00:00:00Z"),
    job("b", "Anything", [], "", "2026-09-01T00:00:00Z"),
  ];
  const before = jobs.map((j) => j.id);
  assert.deepEqual(
    rankJobs(jobs, "").map((r) => r.job.id),
    ["b", "a"],
  );
  assert.deepEqual(
    jobs.map((j) => j.id),
    before,
  );
});

test("matchedTerms reports why a job surfaced", () => {
  const j = job("be", "Backend Engineer", ["go", "postgres"], "Own the API");
  assert.deepEqual(matchedTerms(terms("backend go rust"), j), ["backend", "go"]);
});

test("jobMatches tolerates typos, partial words and searches every field", () => {
  const eng = job("e", "Backend Engineer", ["go", "postgres"], "Own the payments API for a fintech.");
  const design = job("d", "Product Designer", ["figma"], "Shape the design system.");

  assert.ok(jobMatches("enigneer", eng), "transposition");
  assert.ok(jobMatches("enginer", eng), "missing letter");
  assert.ok(jobMatches("enginerr", eng), "extra letter");
  assert.ok(jobMatches("softw", job("s", "Software Engineer")), "prefix");
  assert.ok(jobMatches("react", job("r", "Frontend Dev", ["react"])), "tags are searched");
  assert.ok(jobMatches("fintech", eng), "excerpt is searched");
  assert.ok(jobMatches("acme", job("c", "Anything")), "company is searched");
  assert.ok(jobMatches("backend engineer", eng), "all tokens must match");
  assert.ok(!jobMatches("backend designer", eng), "AND across tokens");
  assert.ok(!jobMatches("zzzzz", eng), "no match stays no match");
  assert.ok(!jobMatches("design", eng), "no cross-job bleed");
  assert.ok(jobMatches("", eng) && jobMatches("   ", eng), "empty query matches everything");
  assert.ok(!jobMatches("go", design), "short tokens are not fuzzy-matched");
  assert.ok(jobMatches("go", eng), "short token still matches exactly");
});

test("fuzzy matching does not invent near-misses between unrelated words", () => {
  const saas = job("s", "SaaS Account Executive");
  assert.ok(!jobMatches("sales", saas), "'sales' must not match 'saas'");
  assert.ok(!jobMatches("leader", job("l", "Senior Lever Operator")), "'leader' must not match 'lever'");
  assert.ok(!jobMatches("great", job("g", "Seat Operations")), "'great' must not match 'seat'");
  assert.ok(jobMatches("enigneer", job("e", "Backend Engineer")), "real transposition still matches");
});

test("search never matches an inner substring of a word", () => {
  const talky = job("t", "Account Manager", [], "Managing interaction with clients.");
  assert.ok(!jobMatches("react", talky), "'react' must not match 'inte(ract)ion'");
  assert.ok(!jobMatches("sign", talky), "'sign' must not match the middle of a word");
  assert.ok(jobMatches("sign", job("s", "Signing Bonus Specialist")), "prefix still matches");
});

test("searchScore ranks title hits above tag hits above excerpt hits", () => {
  const title = job("t", "Kubernetes Platform Engineer");
  const tags = job("g", "Platform person", ["kubernetes"]);
  const excerpt = job("e", "Platform person", [], "We run kubernetes clusters.");
  assert.equal(searchScore("kubernetes", title), 3);
  assert.equal(searchScore("kubernetes", tags), 2);
  assert.equal(searchScore("kubernetes", excerpt), 1);
  assert.equal(searchScore("kubernetes", job("n", "Unrelated")), 0);
  assert.equal(searchScore("kubernetes platform", title), 6, "token scores add up, two title hits");
  assert.equal(searchScore("", title), 0);
});
