import assert from "node:assert/strict";
import test from "node:test";

// Minimal DOM stub: the same surface app.mjs touches during init() and render().
const stub = (id) => {
  const handlers = new Map();
  const obj = {
    id,
    value: "",
    textContent: "",
    _html: "",
    style: {},
    children: [],
    options: [],
    selectedIndex: 0,
    insertAdjacentHTML() {},
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    fire(type, event = {}) {
      for (const fn of handlers.get(type) ?? []) fn({ target: event.target ?? this, ...event });
    },
    setAttribute(k, v) {
      this[k] = v;
    },
    getAttribute(k) {
      return this[k];
    },
    closest(sel) {
      if (sel === ".chip") return this;
      return null;
    },
  };
  Object.defineProperty(obj, "innerHTML", {
    get() {
      return this._html;
    },
    set(html) {
      this._html = html;
      if (id === "chips") {
        this.children = (html.match(/<button[^>]*>([^<]+)<\/button>/g) ?? []).map((m) => {
          const text = m.replace(/<[^>]+>/g, "");
          const btn = stub("btn");
          btn.textContent = text;
          return btn;
        });
      }
    },
  });
  return obj;
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

test("role chips filter by role and combine with fuzzy search via AND", async () => {
  const get = await mount();
  const chips = get("chips");
  const q = get("q");
  const list = get("list");

  assert.deepEqual(ids(list.innerHTML), ["coord", "hr", "marketing", "people", "swe"], "no filter keeps every job");

  const hrBtn = chips.children.find((c) => c.textContent === "HR / recruiter");
  assert.ok(hrBtn, "HR / recruiter chip exists");

  chips.fire("click", { target: hrBtn });
  assert.deepEqual(
    ids(list.innerHTML),
    ["coord", "hr", "people"],
    "noisy recruiter tag on Principal Software Engineer must not pass the role filter",
  );

  q.value = "coord";
  q.fire("input");
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(ids(list.innerHTML), ["coord"], "role filter and fuzzy search combine with AND");

  // Reset q
  q.value = "";
  q.fire("input");
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(ids(list.innerHTML), ["coord", "hr", "people"], "clearing search keeps role filtered");

  // Toggle HR off
  chips.fire("click", { target: hrBtn });
  assert.deepEqual(
    ids(list.innerHTML),
    ["coord", "hr", "marketing", "people", "swe"],
    "toggling role off restores list",
  );

  // Fuzzy search with typo across all jobs
  q.value = "enigneer";
  q.fire("input");
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(ids(list.innerHTML), ["swe"], "fuzzy search handles typos on job title");
});
