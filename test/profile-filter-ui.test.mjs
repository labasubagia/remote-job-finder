import assert from "node:assert/strict";
import test from "node:test";

// Minimal DOM stub: the same surface app.mjs touches during init() and render().
const stub = (id) => {
  const handlers = new Map();
  return {
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    style: {},
    children: [],
    options: [],
    selectedIndex: 0,
    insertAdjacentHTML() {},
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    fire(type) {
      for (const fn of handlers.get(type) ?? []) fn({ target: this });
    },
    setAttribute() {},
  };
};

const job = (id, title, role, tags = []) => ({
  id,
  title,
  company: "Co",
  url: `https://example.com/${id}`,
  source: "test",
  tags,
  role,
  roleConfidence: role ? 0.9 : undefined,
  postedAt: "2026-10-01T00:00:00Z",
  excerpt: "",
  location: null,
  timezoneOffsets: null,
});

const FIXTURE = [
  job("hr", "Recruiter", "hr-recruiter"),
  job("swe", "Principal Software Engineer", undefined, ["dev", "recruiter"]),
  job("people", "People Operations Manager", undefined),
  job("coord", "HR Coordinator", "hr-recruiter"),
  job("marketing", "Growth Lead", "marketing"),
];

const ids = (html) => [...html.matchAll(/example\.com\/([^"]+)"/g)].map((m) => m[1]).sort();

async function mount() {
  const nodes = new Map();
  globalThis.document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, stub(id));
      return nodes.get(id);
    },
  };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => FIXTURE });

  const mod = await import(`../site/app.mjs?${Math.random()}`);
  await mod.init();
  return (id) => globalThis.document.getElementById(id);
}

test("the profile box filters the rendered list with AND conditions", async () => {
  const get = await mount();
  const p = get("p");
  const list = get("list");

  assert.deepEqual(ids(list.innerHTML), ["coord", "hr", "marketing", "people", "swe"], "no profile keeps every job");

  p.value = "HR / recruiter";
  p.fire("input");
  assert.deepEqual(ids(list.innerHTML), ["coord", "hr", "people"], "noisy recruiter tag must not pass the role filter");

  p.value = "HR / recruiter, coordinator";
  p.fire("input");
  assert.deepEqual(ids(list.innerHTML), ["coord"], "a second condition must also match");

  p.value = "HR";
  p.fire("input");
  assert.deepEqual(
    ids(list.innerHTML),
    ["coord", "hr", "people"],
    "HR alias must filter like the full role chip label",
  );

  const q = get("q");
  q.value = "coord";
  q.fire("input");
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(ids(list.innerHTML), ["coord"], "role filter and fuzzy search combine with AND");
});
