import assert from "node:assert/strict";
import test from "node:test";
import { collectJobs, FatalSourceError, fetchText, SOURCES } from "../scripts/fetch-jobs.mjs";

const day = 86_400_000;
const recent = (daysAgo) => new Date(Date.now() - daysAgo * day).toISOString();

const body = {
  remoteok: JSON.stringify([
    { legal: "API Terms of Service: please link back" },
    {
      id: 1,
      position: "Backend Engineer",
      company: "Acme",
      url: "https://remoteok.com/j/1",
      date: recent(1),
      tags: ["node"],
      description: `<p>Remote ${"x".repeat(400)}</p>`,
    },
    {
      id: 2,
      position: "Stale Role",
      company: "Old",
      url: "https://remoteok.com/j/2",
      date: recent(90),
      tags: [],
      description: "",
    },
  ]),
  remotive: JSON.stringify({
    "job-count": 2,
    jobs: [
      {
        id: 7,
        title: "React Dev",
        company_name: "Beta",
        url: "https://remotive.com/j/7",
        publication_date: recent(2).slice(0, 19),
        tags: ["react"],
      },
      {
        id: 8,
        title: "QA",
        company_name: "Beta",
        url: "https://remotive.com/j/8",
        publication_date: recent(3),
        tags: [],
      },
    ],
  }),
  arbeitnow: JSON.stringify({
    data: [
      {
        slug: "remote-sre",
        title: "SRE",
        company_name: "Gamma",
        url: "https://arbeitnow.com/j/remote-sre",
        remote: true,
        created_at: String(Math.floor(Date.now() / 1000)),
        tags: ["sre"],
      },
      {
        slug: "onsite-pm",
        title: "Onsite PM",
        company_name: "Gamma",
        url: "https://arbeitnow.com/j/onsite-pm",
        remote: false,
        created_at: String(Math.floor(Date.now() / 1000)),
        tags: [],
      },
    ],
  }),
  himalayas: JSON.stringify({
    jobs: [
      {
        title: "Platform Lead",
        companyName: "Delta",
        guid: "https://himalayas.app/companies/delta/jobs/platform-lead",
        applicationLink: "https://himalayas.app/jobs/platform-lead",
        pubDate: recent(4),
        categories: ["Engineering"],
        excerpt: "Remote-first team",
      },
    ],
  }),
  wwr: `<?xml version="1.0"?><rss><channel>
    <item>
      <title>Epsilon: Full Time: Senior Rust Engineer</title>
      <link>https://weworkremotely.com/remote-jobs/epsilon-senior-rust-engineer</link>
      <category>Back-End Programming</category>
      <pubDate>${new Date(Date.now() - 5 * day).toUTCString()}</pubDate>
      <description><![CDATA[<p>Remote anywhere</p>]]></description>
    </item>
  </channel></rss>`,
};

const okFetch = (url) => {
  const key = Object.keys(SOURCES).find((k) => SOURCES[k].url.startsWith(url.split("?")[0]));
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body[key]) });
};

test("collects fresh remote jobs from every source, normalised and deduped", async () => {
  const logs = [];
  const jobs = await collectJobs({ fetchImpl: okFetch, log: (m) => logs.push(m) });

  assert.equal(logs.length, 5, "logs one line per source");
  assert.deepEqual([...new Set(jobs.map((j) => j.source))].sort(), [
    "arbeitnow",
    "himalayas",
    "remoteok",
    "remotive",
    "wwr",
  ]);
  assert.equal(jobs.length, 6, "stale remoteok job and onsite arbeitnow job dropped");
  assert.equal(new Set(jobs.map((j) => j.id)).size, jobs.length, "ids unique");

  for (const j of jobs) {
    for (const f of ["id", "title", "company", "url", "source", "tags", "postedAt"]) {
      assert.ok(j[f] !== undefined && j[f] !== null && j[f] !== "", `${j.id} has ${f}`);
    }
    assert.ok(Array.isArray(j.tags), `${j.id} tags is an array`);
    assert.ok(j.excerpt.length <= 200, `${j.id} excerpt <= 200 chars`);
    assert.ok(Date.parse(j.postedAt) > Date.now() - 31 * day, `${j.id} posted within 30d`);
  }
  assert.deepEqual(
    jobs.map((j) => j.postedAt),
    [...jobs.map((j) => j.postedAt)].sort((a, b) => b.localeCompare(a)),
    "sorted newest first",
  );
  assert.equal(jobs.find((j) => j.id === "wwr-epsilon-senior-rust-engineer").company, "Epsilon");
  assert.equal(jobs.find((j) => j.id === "wwr-epsilon-senior-rust-engineer").title, "Full Time: Senior Rust Engineer");
});

test("retries transient failures, then succeeds", async () => {
  let calls = 0;
  const flaky = (url) => (++calls < 3 ? Promise.resolve({ ok: false, status: 503 }) : okFetch(url));
  const jobs = await collectJobs({ fetchImpl: flaky });
  assert.equal(jobs.length, 6);
  assert.equal(calls, 7, "2 retries for remoteok + 1 call per remaining source");
});

test("4xx is fatal and never retried (blocked / ToS / auth)", async () => {
  let calls = 0;
  const blocked = () => {
    calls++;
    return Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve("denied") });
  };
  await assert.rejects(() => fetchText("remoteok", SOURCES.remoteok.url, { fetchImpl: blocked }), FatalSourceError);
  assert.equal(calls, 1);
});

test("network errors are retried and then surface as fatal", async () => {
  let calls = 0;
  const down = () => {
    calls++;
    return Promise.reject(new Error("ECONNRESET"));
  };
  await assert.rejects(() => fetchText("remotive", SOURCES.remotive.url, { fetchImpl: down }), FatalSourceError);
  assert.equal(calls, 3);
});

test("schema change fails loudly instead of publishing a half-empty file", async () => {
  const broken = (url) =>
    okFetch(url).then((r) => ({
      ...r,
      text: () => Promise.resolve(url.includes("himalayas") ? '{"jobs":{}}' : r.text()),
    }));
  await assert.rejects(() => collectJobs({ fetchImpl: broken }), /himalayas/);
});

test("a source with nothing fresh fails the run rather than shipping stale rows", async () => {
  const stale = (url) =>
    okFetch(url).then((r) => ({
      ...r,
      text: () =>
        r
          .text()
          .then((t) =>
            url.includes("remotive")
              ? t.replace(/"publication_date":"[^"]+"/g, `"publication_date":"${recent(120)}"`)
              : t,
          ),
    }));
  await assert.rejects(() => collectJobs({ fetchImpl: stale }), /remotive: 0 of 2 jobs/);
});
