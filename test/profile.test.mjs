import assert from "node:assert/strict";
import { test } from "node:test";
import {
  jobMatches,
  matchedTerms,
  profileMatcher,
  rankJobs,
  roleMatcher,
  scoreJob,
  searchScore,
  terms,
} from "../site/search.mjs";

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

test("profileMatcher trusts a classified role and ignores noisy tags", () => {
  const hr = profileMatcher("HR / recruiter");
  assert.ok(hr({ ...job("h", "Recruiter"), role: "hr-recruiter" }));
  assert.ok(!hr({ ...job("s", "Principal Software Engineer", ["dev", "recruiter"]) }), "a recruiter tag must not pass");
  assert.ok(!hr({ ...job("m", "Marketing Manager"), role: "marketing" }));
});

test("profileMatcher recognizes role aliases without falling back to noisy tag text matching", () => {
  for (const query of ["HR", "hr", "recruiter", "HR / recruiter"]) {
    const matcher = profileMatcher(query);
    assert.ok(matcher({ ...job("h", "Recruiter"), role: "hr-recruiter" }));
    assert.ok(
      !matcher({ ...job("s", "Principal Software Engineer", ["dev", "recruiter"]) }),
      `noisy recruiter tag must not pass for "${query}"`,
    );
    assert.ok(!matcher({ ...job("m", "Marketing Manager"), role: "marketing" }));
  }
});

test("profileMatcher falls back to the title for unclassified jobs", () => {
  const hr = profileMatcher("HR / recruiter");
  assert.ok(hr(job("p", "People Operations Manager")));
  assert.ok(!hr(job("x", "Senior Backend Engineer")));
});

test("profile conditions combine with AND, roles are one IN condition", () => {
  const both = profileMatcher("HR / recruiter, Marketing");
  assert.ok(both({ ...job("h", "Recruiter"), role: "hr-recruiter" }));
  assert.ok(both({ ...job("m", "Growth Lead"), role: "marketing" }));
  assert.ok(!both({ ...job("s", "Backend Engineer"), role: "software-engineer" }));

  const textAnd = profileMatcher("backend, go");
  assert.ok(textAnd(job("g", "Backend Engineer (Go)")));
  assert.ok(!textAnd(job("b", "Backend Engineer")));
  assert.ok(!textAnd(job("go", "Go Developer")));
});

test("an empty profile filters nothing", () => {
  const anything = profileMatcher("   ");
  assert.ok(anything(job("a", "Anything", ["whatever"])));
});

test("roleMatcher accepts a Set of active role labels and filters with SQL IN semantics", () => {
  const activeRoles = new Set(["HR / recruiter"]);
  const matcher = roleMatcher(activeRoles);
  assert.ok(matcher({ ...job("h", "Recruiter"), role: "hr-recruiter" }));
  assert.ok(matcher(job("p", "People Operations Coordinator")));
  assert.ok(
    !matcher({ ...job("s", "Principal Software Engineer", ["dev", "recruiter"]) }),
    "noisy recruiter tag must never match",
  );
  assert.ok(!matcher({ ...job("m", "Growth Lead"), role: "marketing" }));

  activeRoles.add("Marketing");
  const multiMatcher = roleMatcher(activeRoles);
  assert.ok(multiMatcher({ ...job("h", "Recruiter"), role: "hr-recruiter" }));
  assert.ok(multiMatcher({ ...job("m", "Growth Lead"), role: "marketing" }));
  assert.ok(!multiMatcher({ ...job("s", "Software Engineer"), role: "software-engineer" }));
});
