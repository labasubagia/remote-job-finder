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

// Two labels per region plus the awkward cases: global, unlabelled, multi-region,
// and Himalayas rows whose offset list contradicts their location.
const FIXTURE = [
  job("jakarta", "Indonesia", null),
  job("india", "India", null),
  job("tokyo", "Japan", null),
  job("sydney", "Australia", null),
  job("berlin", "Berlin", null),
  job("uk", "United Kingdom", null),
  job("us", "United States", null),
  job("brazil", "Brazil", null),
  job("worldwide", "Worldwide", null),
  job("unlabelled", null, null),
  job("multi", "Europe, LATAM, APAC, the U.S., Canada", null),
  job("offset-apac", "Asia", [7, 8]),
  job("offset-eu", "Germany", [1, 2]),
  job("offset-us", "United States", [-10, -9, -8, -7, -6, -5]),
  // Himalayas closes US-only lists with a UTC+14 sentinel; it must not read as "Asia-friendly".
  job("offset-us-sentinel", "United States", [-10, -9, -8, -7, -6, -5, 14]),
];

const ALWAYS = ["multi", "unlabelled", "worldwide"]; // global or unknowable, kept everywhere

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

// Keep-lists spelled out per user location instead of derived from the region table,
// so a wrong band fails here rather than agreeing with itself.
const LOCATIONS = [
  {
    name: "Jakarta UTC+7",
    utc: 7,
    keep: ["jakarta", "india", "tokyo", "sydney", "offset-apac"],
    drop: ["berlin", "uk", "us", "brazil", "offset-eu", "offset-us", "offset-us-sentinel"],
  },
  {
    name: "Mumbai UTC+5:30 (fractional offset)",
    utc: 5.5,
    keep: ["jakarta", "india", "tokyo", "sydney", "offset-apac"],
    drop: ["berlin", "uk", "us", "brazil", "offset-eu", "offset-us", "offset-us-sentinel"],
  },
  {
    name: "Tokyo UTC+9",
    utc: 9,
    keep: ["jakarta", "india", "tokyo", "sydney", "offset-apac"],
    drop: ["berlin", "uk", "us", "brazil", "offset-eu", "offset-us", "offset-us-sentinel"],
  },
  {
    name: "Sydney UTC+10",
    utc: 10,
    keep: ["jakarta", "india", "tokyo", "sydney", "offset-apac"],
    drop: ["berlin", "uk", "us", "brazil", "offset-eu", "offset-us", "offset-us-sentinel"],
  },
  {
    name: "Auckland UTC+12",
    utc: 12,
    // UTC+12 is 5h from the APAC band's +7..+8 offsets, so those rows go too.
    keep: ["jakarta", "india", "tokyo", "sydney"],
    drop: ["berlin", "uk", "us", "brazil", "offset-eu", "offset-us", "offset-us-sentinel", "offset-apac"],
  },
  {
    name: "London UTC+0",
    utc: 0,
    keep: ["berlin", "uk", "offset-eu"],
    drop: ["jakarta", "india", "tokyo", "sydney", "us", "brazil", "offset-apac", "offset-us", "offset-us-sentinel"],
  },
  {
    name: "Berlin UTC+2",
    utc: 2,
    keep: ["berlin", "uk", "offset-eu"],
    drop: ["jakarta", "india", "tokyo", "sydney", "us", "brazil", "offset-apac", "offset-us", "offset-us-sentinel"],
  },
  {
    name: "New York UTC-4",
    utc: -4,
    keep: ["us", "brazil", "offset-us", "offset-us-sentinel"],
    drop: ["jakarta", "india", "tokyo", "sydney", "berlin", "uk", "offset-eu", "offset-apac"],
  },
  {
    name: "Sao Paulo UTC-3",
    utc: -3,
    keep: ["us", "brazil", "offset-us", "offset-us-sentinel"],
    drop: ["jakarta", "india", "tokyo", "sydney", "berlin", "uk", "offset-eu", "offset-apac"],
  },
  {
    name: "Honolulu UTC-10",
    utc: -10,
    keep: ["us", "brazil", "offset-us", "offset-us-sentinel"],
    drop: ["jakarta", "india", "tokyo", "sydney", "berlin", "uk", "offset-eu", "offset-apac"],
  },
  {
    name: "Pago Pago UTC-11",
    utc: -11,
    keep: ["us", "brazil", "offset-us", "offset-us-sentinel"],
    drop: ["jakarta", "india", "tokyo", "sydney", "berlin", "uk", "offset-eu", "offset-apac"],
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

test("8h still keeps the Americas out, even with a UTC+14 sentinel offset", async () => {
  const { shown } = await mount({ geo: "my-tz", tolerance: "8", utc: 7 });
  try {
    const list = shown();
    assert.ok(list.includes("berlin"), `expected Berlin at 8h, got ${list}`);
    assert.ok(!list.includes("us"), `expected USA hidden at 8h, got ${list}`);
    assert.ok(!list.includes("offset-us-sentinel"), `sentinel 14 leaked USA at 8h: ${list}`);
  } finally {
    restoreDate();
  }
});

test("12h reaches everything", async () => {
  const { shown } = await mount({ geo: "my-tz", tolerance: "12", utc: 7 });
  try {
    assert.equal(shown().length, FIXTURE.length, `expected all jobs at 12h, got ${shown()}`);
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
    assert.deepEqual(shown(), ["brazil", "multi", "offset-us", "offset-us-sentinel", "us"]);
    get("geo").value = "emea";
    get("geo").fire("change");
    assert.deepEqual(shown(), ["berlin", "multi", "offset-eu", "uk"]);
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
