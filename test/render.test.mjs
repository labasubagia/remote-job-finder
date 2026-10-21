import assert from "node:assert/strict";
import test from "node:test";

// Minimal DOM stub: enough surface for init()/render() to run under node.
const stub = (id) => ({
  id,
  value: "",
  textContent: "",
  innerHTML: "",
  style: {},
  children: [],
  options: [{ text: "Any" }],
  selectedIndex: 0,
  insertAdjacentHTML(_, html) {
    this.options.push({ text: html });
  },
  addEventListener() {},
  setAttribute() {},
});

const day = 86_400_000;
const fixture = [
  {
    id: "a-1",
    title: "Backend Engineer",
    company: "Acme",
    url: "https://example.com/1",
    source: "acme",
    tags: ["go"],
    postedAt: new Date(Date.now() - day).toISOString(),
    excerpt: "Remote backend",
  },
  {
    id: "b-2",
    title: "Designer",
    company: "Beta",
    url: "https://example.com/2",
    source: "beta",
    tags: ["figma"],
    postedAt: new Date(Date.now() - 2 * day).toISOString(),
    excerpt: "Remote design",
  },
];

// site/jobs.json is gitignored (built during deploy), so the payload is served from memory.
const mount = async (items) => {
  const nodes = new Map();
  globalThis.document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, stub(id));
      return nodes.get(id);
    },
  };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => items });
  const { init } = await import(`../site/app.mjs?${Math.random()}`);
  await init();
  return (id) => globalThis.document.getElementById(id);
};

test("init renders the fetched jobs instead of discarding them", async () => {
  const get = await mount(fixture);
  const rows = (get("list").innerHTML.match(/<li/g) ?? []).length;

  assert.equal(rows, 2, `expected 2 job rows, got ${rows} (meta: "${get("meta").textContent}")`);
  assert.ok(!get("meta").textContent.includes("No jobs published"), "meta still reports an empty feed");
});

test("init reports an empty feed only when the payload is empty", async () => {
  const get = await mount([]);
  assert.match(get("meta").textContent, /No jobs published/);
});

test("job text is HTML-escaped, so a feed cannot inject markup", async () => {
  const payload = `<img src=x onerror=alert(1)> & "quoted" 'single'`;
  const get = await mount([
    {
      id: "x-1",
      title: payload,
      company: payload,
      url: "https://example.com/x",
      source: "acme",
      tags: [payload],
      postedAt: new Date().toISOString(),
      excerpt: payload,
      location: payload,
    },
  ]);
  const html = get("list").innerHTML;

  assert.ok(!html.includes("<img"), "raw markup from a job reached the DOM");
  assert.ok(!html.includes("<script"), "raw script markup reached the DOM");
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&amp; &quot;quoted&quot; &#39;single&#39;/);
});

test("a non-http url never becomes a live link", async () => {
  const get = await mount([
    {
      id: "x-2",
      title: "Bad link",
      company: "Acme",
      url: "javascript:alert(1)",
      source: "acme",
      tags: [],
      postedAt: new Date().toISOString(),
      excerpt: "",
    },
  ]);

  assert.match(get("list").innerHTML, /href="#"/);
  assert.ok(!get("list").innerHTML.includes("javascript:"));
});

test("a job without tags does not crash the renderer", async () => {
  const get = await mount([
    {
      id: "x-3",
      title: "No tags",
      company: "Acme",
      url: "https://example.com/x",
      source: "acme",
      postedAt: new Date().toISOString(),
      excerpt: "",
    },
  ]);

  assert.match(get("list").innerHTML, /No tags/);
  assert.match(get("meta").textContent, /1 of 1/);
});
test("a missing DOM element fails with a clear message instead of a TypeError", async () => {
  const ids = ["q", "src", "geo", "sort", "chips", "list", "meta"]; // no tzTolerance
  const nodes = new Map(ids.map((id) => [id, stub(id)]));
  globalThis.document = { getElementById: (id) => nodes.get(id) ?? null };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [] });
  const { init } = await import(`../site/app.mjs?${Math.random()}`);
  await assert.rejects(init(), /Required DOM element not found/);
});
test("non-array jobs.json payload is rejected with a clear message", async () => {
  const nodes = new Map(
    ["q", "src", "geo", "sort", "chips", "list", "meta", "tzTolerance"].map((id) => [id, stub(id)]),
  );
  globalThis.document = { getElementById: (id) => nodes.get(id) ?? null };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ not: "an array" }) });
  const { init } = await import(`../site/app.mjs?${Math.random()}`);
  await assert.rejects(init(), /must be a JSON array/);
});
