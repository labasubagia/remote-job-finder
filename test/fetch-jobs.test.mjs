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
  jobicy: JSON.stringify({
    jobs: [
      {
        id: 101,
        jobTitle: "Backend Engineer",
        companyName: "JobicyCo",
        url: "https://jobicy.com/j/101",
        pubDate: recent(1),
        jobIndustry: ["Software Engineering"],
        jobExcerpt: "Remote backend role",
        jobDescription: "",
      },
      {
        id: 102,
        jobTitle: "Stale Designer",
        companyName: "OldCo",
        url: "https://jobicy.com/j/102",
        pubDate: recent(90),
        jobIndustry: ["Web, UI & UX Design"],
        jobExcerpt: "Stale",
      },
    ],
  }),
  workingnomads: JSON.stringify([
    {
      url: "https://www.workingnomads.com/job/go/201/",
      title: "Frontend Developer",
      company_name: "WNCo",
      pub_date: recent(2),
      tags: "react,typescript",
      category_name: "Development",
      description: "Remote frontend",
      location: "Worldwide",
    },
  ]),
  nodesk: `<?xml version="1.0"?><rss><channel>
    <item>
      <title>Full Stack Engineer at NodeskCo</title>
      <link>https://nodesk.co/remote-jobs/nodesk-fullstack/</link>
      <pubDate>${new Date(Date.now() - 3 * day).toUTCString()}</pubDate>
      <description><![CDATA[<p>Remote full stack</p>]]></description>
    </item>
  </channel></rss>`,
  jobspresso: `<?xml version="1.0"?><rss><channel>
    <item>
      <title>DevOps Engineer</title>
      <link>https://jobspresso.co/job/devops-engineer/</link>
      <dc:creator><![CDATA[JobspressoCo<br>⚲ United States (Remote)]]></dc:creator>
      <pubDate>${new Date(Date.now() - 4 * day).toUTCString()}</pubDate>
      <description><![CDATA[<p>Remote devops</p>]]></description>
    </item>
  </channel></rss>`,
  dribbble: `<?xml version="1.0"?><rss><channel>
    <item>
      <title>DesignCo is hiring for a position of Product Designer in Remote</title>
      <link>https://dribbble.com/jobs/301-Product-Designer?source=feed</link>
      <pubDate>${new Date(Date.now() - 5 * day).toUTCString()}</pubDate>
      <description><![CDATA[<p>Remote product design</p>]]></description>
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

  assert.equal(logs.length, 10, "logs one line per source");
  assert.deepEqual([...new Set(jobs.map((j) => j.source))].sort(), [
    "arbeitnow",
    "dribbble",
    "himalayas",
    "jobicy",
    "jobspresso",
    "nodesk",
    "remoteok",
    "remotive",
    "workingnomads",
    "wwr",
  ]);
  assert.equal(jobs.length, 11, "stale/onsite jobs dropped");
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
  assert.equal(jobs.find((j) => j.id === "jobicy-101").title, "Backend Engineer");
  assert.equal(jobs.find((j) => j.id === "dribbble-301-Product-Designer").source, "dribbble");
});

test("retries transient failures, then succeeds", async () => {
  let calls = 0;
  const flaky = (url) => (++calls < 3 ? Promise.resolve({ ok: false, status: 503 }) : okFetch(url));
  const jobs = await collectJobs({ fetchImpl: flaky });
  assert.equal(jobs.length, 11);
  assert.equal(calls, 12, "2 retries for remoteok + 1 call per remaining source");
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

test("decodes numeric and hex character references without double-decoding", () => {
  const [job] = SOURCES.remoteok.parse(
    JSON.stringify([
      { legal: "x" },
      {
        id: 3,
        position: "Café",
        company: "Ampersand & Co",
        url: "https://remoteok.com/j/3",
        date: recent(1),
        description: "<p>caf&#233; &#x2014; R&amp;D &amp;lt;not a tag&amp;gt; &#xD800;</p>",
      },
    ]),
  );
  assert.equal(
    job.excerpt,
    "café — R&D &lt;not a tag&gt; \uFFFD",
    "entities decode once and a lone surrogate becomes U+FFFD",
  );
});

test("accepts millisecond epochs and rejects timestamps it cannot represent", () => {
  const parse = (date) =>
    SOURCES.remoteok.parse(
      JSON.stringify([{ legal: "x" }, { id: 4, position: "Milli", url: "https://remoteok.com/j/4", date }]),
    )[0].postedAt;
  assert.equal(parse(String(1_700_000_000_000)), "2023-11-14T22:13:20.000Z");
  assert.equal(parse("1700000000"), "2023-11-14T22:13:20.000Z");
  assert.equal(parse("999999999999999999999"), null, "out of range is null, not a RangeError");
  assert.equal(parse("170000000000000000000000"), null);
});

test("an excerpt never ends inside a surrogate pair", () => {
  const [job] = SOURCES.remoteok.parse(
    JSON.stringify([
      { legal: "x" },
      {
        id: 5,
        position: "Emoji",
        url: "https://remoteok.com/j/5",
        date: recent(1),
        description: `${"a".repeat(198)}😀tail`,
      },
    ]),
  );
  assert.ok(job.excerpt.length <= 200, "still truncated");
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(job.excerpt), "no lone high surrogate");
  assert.ok(!/[\uDC00-\uDFFF]/.test(job.excerpt), "no lone low surrogate");
  assert.ok(job.excerpt.endsWith("…"));
});

test("jobs whose url is not http(s) are dropped instead of becoming javascript: links", async () => {
  const logs = [];
  const hostile = (url) =>
    okFetch(url).then((r) => ({
      ...r,
      text: () =>
        r.text().then((t) =>
          url.includes("remoteok") || url.includes("jobicy")
            ? // append one fresh row carrying a hostile scheme; the legit rows stay
              t.replace(
                /\]$/,
                `,{"id":99,"position":"Hostile","url":"javascript:alert(document.cookie)","date":"${recent(1)}"}]`,
              )
            : t,
        ),
    }));
  const jobs = await collectJobs({ fetchImpl: hostile, log: (m) => logs.push(m) });
  assert.ok(!jobs.some((j) => j.url.startsWith("javascript:")), "no javascript: url published");
  assert.ok(jobs.every((j) => /^https?:\/\//.test(j.url)));
  assert.equal(jobs.length, 11, "the hostile rows are gone, the legit rows remain");
  assert.ok(
    logs.some((m) => m.includes("non-http url")),
    "dropping is logged",
  );
});

test("invalid JSON from a source throws FatalSourceError with a clear message", async () => {
  const badJson = (url) => {
    if (url.includes("remoteok")) {
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("not json") });
    }
    return okFetch(url);
  };
  await assert.rejects(
    collectJobs({ fetchImpl: badJson }),
    (err) => err instanceof FatalSourceError && err.message.includes("invalid JSON"),
  );
});

test("RSS items with attributes on the <item> tag are still parsed", async () => {
  const attrRss = (url) => {
    if (url.includes("weworkremotely")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            `<?xml version="1.0"?><rss><channel><item id="1" foo="bar"><title>Acme: Engineer</title><link>https://ex.com/1</link><pubDate>${recent(1)}</pubDate><description>Desc</description><category>dev</category></item></channel></rss>`,
          ),
      });
    }
    return okFetch(url);
  };
  const jobs = await collectJobs({ fetchImpl: attrRss, maxAgeDays: 30 });
  assert.ok(
    jobs.some((j) => j.title === "Engineer" && j.source === "wwr"),
    "item with attributes parsed",
  );
});
test("non-string location is coerced instead of crashing .trim()", async () => {
  const jsonRss = (url) => {
    if (url.includes("remoteok")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify([
              {
                id: "1",
                position: "Eng",
                company: "Acme",
                location: 12345,
                url: "https://ex.com/1",
                date: recent(1),
                description: "d",
                tags: [],
              },
              {
                id: "2",
                position: "Dev",
                company: "Co",
                location: null,
                url: "https://ex.com/2",
                date: recent(1),
                description: "d",
                tags: [],
              },
            ]),
          ),
      });
    }
    return okFetch(url);
  };
  const jobs = await collectJobs({ fetchImpl: jsonRss, maxAgeDays: 30 });
  const j1 = jobs.find((j) => j.id === "remoteok-1");
  const j2 = jobs.find((j) => j.id === "remoteok-2");
  assert.equal(j1.location, "12345");
  assert.equal(j2.location, null);
});
test("a field name only matches that exact tag, so <linkfoo> cannot shadow <link>", async () => {
  const prefixRss = (url) => {
    if (url.includes("weworkremotely")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            `<?xml version="1.0"?><rss><channel><item><linkfoo>https://evil.test/x</linkfoo><title>Acme: Engineer</title><link>https://ex.com/1</link><pubDate>${recent(1)}</pubDate><description>Desc</description><category>dev</category></item></channel></rss>`,
          ),
      });
    }
    return okFetch(url);
  };
  const jobs = await collectJobs({ fetchImpl: prefixRss, maxAgeDays: 30 });
  assert.ok(
    jobs.some((j) => j.url === "https://ex.com/1"),
    "the real <link> wins",
  );
  assert.ok(!jobs.some((j) => j.url.includes("evil.test")), "a longer tag name is not a match");
});

test("a response body that fails mid-read is retried, then fatal", async () => {
  let calls = 0;
  const brokenBody = () => {
    calls++;
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.reject(new Error("stream reset")),
    });
  };
  await assert.rejects(
    () => fetchText("remoteok", SOURCES.remoteok.url, { fetchImpl: brokenBody, attempts: 2 }),
    /body read failed/,
  );
  assert.equal(calls, 2);
});
