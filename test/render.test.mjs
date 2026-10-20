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
