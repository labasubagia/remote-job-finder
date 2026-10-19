import assert from "node:assert/strict";
import { test } from "node:test";
import { matchedTerms, rankJobs, scoreJob, terms } from "../site/profile.mjs";

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

  const equal = [job("old", "Data Scientist", ["data"], "", "2026-01-01T00:00:00Z"), job("new", "Data Scientist", ["data"], "", "2026-10-01T00:00:00Z")];
  assert.deepEqual(
    rankJobs(equal, "data").map((r) => r.job.id),
    ["new", "old"],
  );
});

test("rankJobs with no profile is pure recency and never reorders the input array", () => {
  const jobs = [job("a", "Anything", [], "", "2026-01-01T00:00:00Z"), job("b", "Anything", [], "", "2026-09-01T00:00:00Z")];
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
