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

// Post-build shape: every location is already resolved to UTC offsets by
// scripts/timezone.mjs, so these fixtures use real values (Copenhagen +2,
// Vancouver -7) rather than names the browser would have to interpret.
const FIXTURE = [
  job("jakarta", "Indonesia", [7]),
  job("india", "India", [5.5]),
  job("tokyo", "Japan", [9]),
  job("sydney", "Australia", [10, 11]),
  job("berlin", "Berlin", [2]),
  job("uk", "United Kingdom", [1]),
  job("us", "United States", [-10, -9, -8, -7, -6, -5, -4]),
  job("brazil", "Brazil", [-5, -4, -3]),
  job("copenhagen", "Copenhagen", [2]),
  job("vancouver", "Vancouver", [-7]),
  job("worldwide", "Worldwide", null),
  job("unlabelled", null, null),
  job("multi", "Europe, LATAM, APAC, the U.S., Canada", [-7, -6, -5, -4, -3, 0, 1, 2, 3, 5, 6, 7, 8, 9, 10]),
  job("offset-apac", "Asia", [7, 8]),
  job("offset-eu", "Germany", [1, 2]),
  job("offset-us", "United States", [-10, -9, -8, -7, -6, -5, -4]),
];

const ALWAYS = ["unlabelled", "worldwide"]; // no location or a global one: kept everywhere

const REAL_DATE = Date;
const restoreDate = () => {
  globalThis.Date = REAL_DATE;
};

// The browser clock decides the user's offset, so each case supplies its own.
const pinTimezone = (utcHours) =>
  class extends REAL_DATE {
    getTimezoneOffset() {
      return Math.round(-utcHours * 60);
    }
  };

const mount = async ({ geo = "", tolerance = "", utc = 7 } = {}) => {
  const nodes = new Map();
  globalThis.document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, stub(id));
      return nodes.get(id);
    },
  };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => FIXTURE });
  globalThis.Date = pinTimezone(utc);

  const mod = await import(`../site/app.mjs?${Math.random()}`);
  await mod.init();

  const get = (id) => globalThis.document.getElementById(id);
  get("geo").value = geo;
  get("tzTolerance").value = tolerance;
  get("geo").fire("change"); // re-render through the real listener wiring

  return { get, shown: () => ids(get("list").innerHTML).sort() };
};

// <a href="https://example.com/<id>" ...
const ids = (html) => [...html.matchAll(/example\.com\/([^"]+)"/g)].map((m) => m[1]);

// Keep-lists spelled out per user location instead of derived from the bands, so a
// wrong band fails here rather than agreeing with itself.
const LOCATIONS = [
  {
    name: "Jakarta UTC+7",
    utc: 7,
    keep: ["jakarta", "india", "tokyo", "multi", "offset-apac"],
    drop: ["berlin", "uk", "us", "brazil", "copenhagen", "vancouver", "offset-eu", "offset-us"],
  },
  {
    name: "Mumbai UTC+5:30 (fractional offset)",
    utc: 5.5,
    // Tokyo is 3.5h out, so a 2h window excludes it.
    keep: ["jakarta", "india", "multi", "offset-apac"],
    drop: ["tokyo", "sydney", "berlin", "uk", "us", "brazil", "copenhagen", "vancouver", "offset-eu", "offset-us"],
  },
  {
    name: "Tokyo UTC+9",
    utc: 9,
    keep: ["jakarta", "multi", "tokyo", "sydney", "offset-apac"],
    drop: ["india", "berlin", "uk", "us", "brazil", "copenhagen", "vancouver", "offset-eu", "offset-us"],
  },
  {
    name: "Sydney UTC+10",
    utc: 10,
    keep: ["multi", "tokyo", "sydney", "offset-apac"],
    drop: ["jakarta", "india", "berlin", "uk", "us", "brazil", "copenhagen", "vancouver", "offset-eu", "offset-us"],
  },
  {
    name: "Auckland UTC+12",
    utc: 12,
    // Sydney is the only APAC row within 2h; the +7/+9 rows are 3-5h out.
    keep: ["multi", "sydney"],
    drop: [
      "jakarta",
      "india",
      "tokyo",
      "offset-apac",
      "berlin",
      "uk",
      "us",
      "brazil",
      "copenhagen",
      "vancouver",
      "offset-eu",
      "offset-us",
    ],
  },
  {
    name: "London UTC+0",
    utc: 0,
    keep: ["berlin", "copenhagen", "multi", "offset-eu", "uk"],
    drop: ["jakarta", "india", "tokyo", "sydney", "us", "brazil", "vancouver", "offset-apac", "offset-us"],
  },
  {
    name: "Berlin UTC+2",
    utc: 2,
    keep: ["berlin", "copenhagen", "multi", "offset-eu", "uk"],
    drop: ["jakarta", "india", "tokyo", "sydney", "us", "brazil", "vancouver", "offset-apac", "offset-us"],
  },
  {
    name: "New York UTC-4",
    utc: -4,
    keep: ["brazil", "multi", "offset-us", "us"],
    drop: [
      "jakarta",
      "india",
      "tokyo",
      "sydney",
      "berlin",
      "uk",
      "copenhagen",
      "vancouver",
      "offset-eu",
      "offset-apac",
    ],
  },
  {
    name: "Sao Paulo UTC-3",
    utc: -3,
    keep: ["brazil", "multi", "offset-us", "us"],
    drop: [
      "jakarta",
      "india",
      "tokyo",
      "sydney",
      "berlin",
      "uk",
      "copenhagen",
      "vancouver",
      "offset-eu",
      "offset-apac",
    ],
  },
  {
    name: "Honolulu UTC-10",
    utc: -10,
    // Vancouver (-7) is 3h out; only the widest US list still overlaps.
    keep: ["us", "offset-us"],
    drop: [
      "jakarta",
      "india",
      "tokyo",
      "sydney",
      "berlin",
      "uk",
      "brazil",
      "copenhagen",
      "vancouver",
      "offset-eu",
      "offset-apac",
      "multi",
    ],
  },
  {
    name: "Pago Pago UTC-11",
    utc: -11,
    keep: ["us", "offset-us"],
    drop: [
      "jakarta",
      "india",
      "tokyo",
      "sydney",
      "berlin",
      "uk",
      "brazil",
      "copenhagen",
      "vancouver",
      "offset-eu",
      "offset-apac",
      "multi",
    ],
  },
];

for (const { name, utc, keep, drop } of LOCATIONS) {
  test(`my-tz (2h) from ${name}`, async () => {
    const { shown } = await mount({ geo: "my-tz", tolerance: "2", utc });
    try {
      assert.deepEqual(shown(), [...keep, ...ALWAYS].sort());
      for (const id of drop) assert.ok(!shown().includes(id), `${id} should be hidden from ${name}`);
    } finally {
      restoreDate();
    }
  });
}

test("the boundary is inclusive: Berlin leaves at 4h and returns at 5h", async () => {
  const four = await mount({ geo: "my-tz", tolerance: "4", utc: 7 });
  try {
    assert.ok(!four.shown().includes("berlin"), `Berlin is 5h away, should not show at 4h`);
  } finally {
    restoreDate();
  }

  const five = await mount({ geo: "my-tz", tolerance: "5", utc: 7 });
  try {
    assert.ok(five.shown().includes("berlin"), `Berlin should show at exactly 5h`);
  } finally {
    restoreDate();
  }
});

test("a 12h tolerance still cannot reach the other side of the planet", async () => {
  const { shown } = await mount({ geo: "my-tz", tolerance: "12", utc: 7 });
  try {
    const list = shown();
    // +7 minus 12h is UTC-5, so Brazil is in and Vancouver (-7) is not.
    assert.ok(list.includes("brazil"));
    assert.ok(!list.includes("vancouver"), `Vancouver is 14h from Jakarta: ${list}`);
    assert.ok(list.includes("us"), `the US east coast is 11h from Jakarta: ${list}`);
  } finally {
    restoreDate();
  }
});

test("a job with no resolvable location is kept rather than guessed away", async () => {
  const { shown } = await mount({ geo: "my-tz", tolerance: "0", utc: 7 });
  try {
    assert.ok(shown().includes("unlabelled"));
    assert.ok(shown().includes("worldwide"));
  } finally {
    restoreDate();
  }
});

test("an emptied tolerance field falls back to 2h instead of 0h", async () => {
  const two = await mount({ geo: "my-tz", tolerance: "2", utc: 7 });
  const expected = two.shown();
  restoreDate();

  const blank = await mount({ geo: "my-tz", tolerance: "", utc: 7 });
  try {
    assert.deepEqual(blank.shown(), expected);
  } finally {
    restoreDate();
  }
});

test("regional dropdowns agree with the same regions", async () => {
  // Regional picks hide unlabelled and worldwide rows; only multi-region labels survive.
  const { get, shown } = await mount({ geo: "americas", utc: 7 });
  try {
    assert.deepEqual(shown(), ["brazil", "multi", "offset-us", "us", "vancouver"]);
    get("geo").value = "emea";
    get("geo").fire("change");
    assert.deepEqual(shown(), ["berlin", "copenhagen", "multi", "offset-eu", "uk"]);
    get("geo").value = "apac";
    get("geo").fire("change");
    assert.deepEqual(shown(), ["india", "jakarta", "multi", "offset-apac", "sydney", "tokyo"]);
    get("geo").value = "worldwide";
    get("geo").fire("change");
    assert.deepEqual(shown(), ["worldwide"]);
  } finally {
    restoreDate();
  }
});
