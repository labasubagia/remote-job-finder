import assert from "node:assert/strict";
import { test } from "node:test";
import { applyRoles, pickRole, ROLE_CONFIG, samePosting } from "../scripts/roles.mjs";
import { ROLES } from "../site/search.mjs";

const job = (id, title, extra = {}) => ({
  id,
  title,
  company: "Acme",
  tags: [],
  excerpt: "",
  postedAt: "2026-10-01T00:00:00Z",
  ...extra,
});

test("taxonomy stays in step with the profile chips", () => {
  const labels = ROLE_CONFIG.roles.filter((role) => role.id !== "other").map((role) => role.label);
  assert.deepEqual(labels, ROLES);
  assert.equal(new Set(ROLE_CONFIG.roles.map((role) => role.id)).size, ROLE_CONFIG.roles.length);
  assert.ok(ROLE_CONFIG.roles.some((role) => role.id === "other"));
});

test("pickRole drops abstentions, other, and answers below the threshold", () => {
  assert.equal(pickRole({ role: "marketing", confidence: 0.69 }), null);
  assert.deepEqual(pickRole({ role: "marketing", confidence: 0.7 }), { role: "marketing", roleConfidence: 0.7 });
  assert.equal(pickRole({ role: "marketing", confidence: 0.95, abstained: true }), null);
  assert.equal(pickRole({ role: "other", confidence: 0.99 }), null);
  assert.equal(pickRole(null), null);
});

test("samePosting requires id, title and company to agree", () => {
  const a = job("1", "Backend Engineer");
  assert.ok(samePosting(a, { ...a }));
  assert.ok(!samePosting(a, { ...a, title: "Frontend Engineer" }));
  assert.ok(!samePosting(a, { ...a, company: "Other" }));
  assert.ok(!samePosting(a, null));
});

test("applyRoles reuses a cached answer for an unchanged posting", () => {
  const current = job("1", "Backend Engineer");
  const previous = job("1", "Backend Engineer", { role: "software-engineer", roleConfidence: 0.91 });
  const [merged] = applyRoles([current], [previous], { 1: { role: "sales", confidence: 0.99 } });
  assert.equal(merged.role, "software-engineer");
  assert.equal(merged.roleConfidence, 0.91);
});

test("applyRoles re-predicts when the posting changed and drops stale roles", () => {
  const previous = job("1", "Backend Engineer", { role: "software-engineer", roleConfidence: 0.91 });
  const [renamed] = applyRoles([job("1", "Account Executive")], [previous], { 1: { role: "sales", confidence: 0.88 } });
  assert.deepEqual([renamed.role, renamed.roleConfidence], ["sales", 0.88]);

  const [low] = applyRoles([job("1", "Account Executive")], [previous], {
    1: { role: "sales", confidence: 0.5, abstained: true },
  });
  assert.equal("role" in low, false);
  assert.equal("roleConfidence" in low, false);
});

test("applyRoles leaves uncached jobs without a prediction untouched", () => {
  const [merged] = applyRoles([job("2", "Mystery Role")], []);
  assert.deepEqual(merged, job("2", "Mystery Role"));
});
