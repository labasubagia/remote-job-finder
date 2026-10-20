import assert from "node:assert/strict";
import test from "node:test";

// Minimal DOM stub: enough surface for init()/render() to run under node.
const stub = (id) => {
  const handlers = new Map();
  return {
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

const day = 86_400_000;
const job = (id, location, timezoneOffsets) => ({
  id,
  title: id,
  company: "Co",
  url: `https://example.com/${id}`,
  source: "test",
  tags: [],
  postedAt: new Date(Date.now() - day).toISOString(),
  excerpt: "",
  location,
  timezoneOffsets,
});

const FIXTURE = [
  job("jakarta", "Indonesia", null),
  job("us-only", "USA", null),
  job("canada", "Canada", null),
  job("germany", "Germany", null),
  job("berlin", "Berlin", null),
  job("uk", "United Kingdom", null),
  job("worldwide", "Worldwide", null),
  job("unlabelled", null, null),
  job("multi", "Europe, LATAM, APAC, the U.S., Canada", null),
  job("offset-apac", "Asia", [7, 8]),
  job("offset-us", "United States", [-10, -9, -8, -7, -6, -5]),
  // Himalayas closes US-only lists with a UTC+14 sentinel; it must not read as "Asia-friendly".
  job("offset-us-sentinel", "United States", [-10, -9, -8, -7, -6, -5, 14]),
  job("offset-eu", "Germany", [1, 2]),
];

const REAL_DATE = Date;

// Pin the page to UTC+7 (Indonesia) regardless of the machine running the suite.
class PinnedDate extends REAL_DATE {
  getTimezoneOffset() {
    return -420;
  }
}

const mount = async ({ geo = "", tolerance = "" } = {}) => {
  const nodes = new Map();
  globalThis.document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, stub(id));
      return nodes.get(id);
    },
  };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => FIXTURE });
  globalThis.Date = PinnedDate;

  const mod = await import(`../site/app.mjs?${Math.random()}`);
  await mod.init();

  const get = (id) => globalThis.document.getElementById(id);
  get("geo").value = geo;
  get("tzTolerance").value = tolerance;
  get("geo").fire("change"); // re-render through the real listener wiring

  return { get, shown: () => ids(get("list").innerHTML) };
};

// <a href="https://example.com/<id>" ...
const ids = (html) => [...html.matchAll(/example\.com\/([^"]+)"/g)].map((m) => m[1]);

test("my-tz hides jobs whose region cannot overlap the user's window", async () => {
  const { shown } = await mount({ geo: "my-tz", tolerance: "2" });

  // Kept: APAC, global, unlabelled (unknowable) and multi-region (APAC is listed).
  assert.deepEqual(shown().sort(), ["jakarta", "multi", "offset-apac", "unlabelled", "worldwide"]);
  globalThis.Date = REAL_DATE;
});

test("city-only and country labels both map to their region", async () => {
  const { shown } = await mount({ geo: "my-tz", tolerance: "2" });
  const list = shown();

  assert.ok(!list.includes("berlin"), `expected Berlin to be hidden, got ${list}`);
  assert.ok(!list.includes("germany"), `expected Germany to be hidden, got ${list}`);
  assert.ok(!list.includes("uk"), `expected UK to be hidden, got ${list}`);
  assert.ok(!list.includes("us-only"), `expected USA to be hidden, got ${list}`);
  assert.ok(!list.includes("offset-us"), `expected US offsets to be hidden, got ${list}`);
  globalThis.Date = REAL_DATE;
});

test("widening the tolerance reaches Europe but not the Americas", async () => {
  const { shown } = await mount({ geo: "my-tz", tolerance: "9" });
  const list = shown();

  // 9h around UTC+7 spans UTC-2..+16, which overlaps EMEA but not the Americas.
  assert.ok(list.includes("germany"), `expected germany, got ${list}`);
  assert.ok(list.includes("uk"), `expected uk, got ${list}`);
  assert.ok(!list.includes("us-only"), `expected USA to stay out, got ${list}`);
  assert.ok(!list.includes("canada"), `expected Canada to stay out, got ${list}`);
  globalThis.Date = REAL_DATE;
});

test("8h still keeps the Americas out, even with a UTC+14 sentinel offset", async () => {
  const { shown } = await mount({ geo: "my-tz", tolerance: "8" });
  const list = shown();

  assert.ok(list.includes("germany"), `expected germany at 8h, got ${list}`);
  assert.ok(!list.includes("us-only"), `expected USA hidden at 8h, got ${list}`);
  assert.ok(!list.includes("offset-us"), `expected US offsets hidden at 8h, got ${list}`);
  assert.ok(!list.includes("offset-us-sentinel"), `sentinel 14 leaked USA at 8h: ${list}`);
  globalThis.Date = REAL_DATE;
});

test("12h reaches everything", async () => {
  const { shown } = await mount({ geo: "my-tz", tolerance: "12" });
  const list = shown();

  assert.equal(list.length, FIXTURE.length, `expected all jobs at 12h, got ${list}`);
  globalThis.Date = REAL_DATE;
});

test("an emptied tolerance field falls back to 2h instead of 0h", async () => {
  const { shown } = await mount({ geo: "my-tz", tolerance: "" });

  assert.deepEqual(shown().sort(), ["jakarta", "multi", "offset-apac", "unlabelled", "worldwide"]);
  globalThis.Date = REAL_DATE;
});
