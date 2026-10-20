import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

const mount = async () => {
  const nodes = new Map();
  globalThis.document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, stub(id));
      return nodes.get(id);
    },
  };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => JSON.parse(await readFile(new URL("../site/jobs.json", import.meta.url), "utf8")),
  });
  const { init } = await import(`../site/app.mjs?${Math.random()}`);
  await init();
  return (id) => globalThis.document.getElementById(id);
};

test("init renders the fetched jobs instead of discarding them", async () => {
  const get = await mount();
  const rows = (get("list").innerHTML.match(/<li/g) ?? []).length;

  assert.ok(rows > 0, `expected job rows, got ${rows} (meta: "${get("meta").textContent}")`);
  assert.ok(!get("meta").textContent.includes("No jobs published"), "meta still reports an empty feed");
});
