import assert from "node:assert/strict";
import test from "node:test";
import { collectJobs, SOURCES } from "../scripts/fetch-jobs.mjs";

const day = 86_400_000;
const recent = (daysAgo) => new Date(Date.now() - daysAgo * day).toISOString();

const geoBody = {
  himalayas: JSON.stringify({
    jobs: [
      {
        title: "US Engineer",
        companyName: "USCo",
        guid: "https://himalayas.app/companies/usco/jobs/us-engineer",
        applicationLink: "https://himalayas.app/jobs/us-engineer",
        pubDate: recent(1),
        categories: ["Engineering"],
        excerpt: "US timezone",
        locationRestrictions: ["United States", "Canada"],
        timezoneRestrictions: [-8, -7, -6, -5],
      },
      {
        title: "EU Engineer",
        companyName: "EUCo",
        guid: "https://himalayas.app/companies/euco/jobs/eu-engineer",
        applicationLink: "https://himalayas.app/jobs/eu-engineer",
        pubDate: recent(2),
        categories: ["Engineering"],
        excerpt: "EU timezone",
        locationRestrictions: ["Germany", "France"],
        timezoneRestrictions: [1, 2],
      },
      {
        title: "APAC Engineer",
        companyName: "APACCo",
        guid: "https://himalayas.app/companies/apacco/jobs/apac-engineer",
        applicationLink: "https://himalayas.app/jobs/apac-engineer",
        pubDate: recent(3),
        categories: ["Engineering"],
        excerpt: "APAC timezone",
        locationRestrictions: ["Singapore", "Australia"],
        timezoneRestrictions: [8, 9, 10],
      },
    ],
  }),
  jobicy: JSON.stringify({
    jobs: [
      {
        id: 201,
        jobTitle: "Worldwide Role",
        companyName: "GlobalCo",
        url: "https://jobicy.com/j/201",
        pubDate: recent(1),
        jobIndustry: ["Software Engineering"],
        jobExcerpt: "Worldwide remote",
        jobDescription: "",
        jobGeo: "Worldwide",
      },
      {
        id: 202,
        jobTitle: "US Role",
        companyName: "USCo",
        url: "https://jobicy.com/j/202",
        pubDate: recent(2),
        jobIndustry: ["Software Engineering"],
        jobExcerpt: "US only",
        jobDescription: "",
        jobGeo: "USA",
      },
    ],
  }),
  wwr: `<?xml version="1.0"?><rss><channel>
    <item>
      <title>Epsilon: Full Time: Senior Rust Engineer</title>
      <link>https://weworkremotely.com/remote-jobs/epsilon-senior-rust-engineer</link>
      <category>Back-End Programming</category>
      <pubDate>${new Date(Date.now() - 5 * day).toUTCString()}</pubDate>
      <description><![CDATA[<p><strong>Headquarters:</strong> Remote from US</p>]]></description>
    </item>
    <item>
      <title>Zeta: Full Time: Frontend Developer</title>
      <link>https://weworkremotely.com/remote-jobs/zeta-frontend-developer</link>
      <category>Front-End Programming</category>
      <pubDate>${new Date(Date.now() - 3 * day).toUTCString()}</pubDate>
      <description><![CDATA[<p><strong>Headquarters:</strong> London, UK</p>]]></description>
    </item>
  </channel></rss>`,
  remoteok: JSON.stringify([
    { legal: "API Terms of Service: please link back" },
    {
      id: 10,
      position: "Backend Engineer",
      company: "Acme",
      url: "https://remoteok.com/j/10",
      date: recent(1),
      tags: ["node"],
      description: `<p>Remote ${"x".repeat(100)}</p>`,
      location: "Worldwide",
    },
  ]),
  remotive: JSON.stringify({
    "job-count": 1,
    jobs: [
      {
        id: 20,
        title: "React Dev",
        company_name: "Beta",
        url: "https://remotive.com/j/20",
        publication_date: recent(2).slice(0, 19),
        tags: ["react"],
        candidate_required_location: "Worldwide",
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
        location: "Berlin, Germany",
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

const geoFetch = (url) => {
  const key = Object.keys(SOURCES).find((k) => SOURCES[k].url.startsWith(url.split("?")[0]));
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(geoBody[key] || "") });
};

test("geo filter: the build resolves a location into offsets", async () => {
  const jobs = await collectJobs({ fetchImpl: geoFetch });
  const himalayasJobs = jobs.filter((j) => j.source === "himalayas");

  assert.equal(himalayasJobs.length, 3);

  // Offsets follow the location, not the source's own list: Germany is +2 in July.
  const usJob = himalayasJobs.find((j) => j.title === "US Engineer");
  assert.ok(usJob.location?.includes("United States"));
  assert.ok(usJob.timezoneOffsets?.includes(-5));
  assert.ok(usJob.timezoneOffsets?.includes(-8));

  const euJob = himalayasJobs.find((j) => j.title === "EU Engineer");
  assert.ok(euJob.location?.includes("Germany"));
  assert.ok(
    euJob.timezoneOffsets?.every((off) => off === 1 || off === 2),
    `got ${euJob.timezoneOffsets}`,
  );

  const apacJob = himalayasJobs.find((j) => j.title === "APAC Engineer");
  assert.ok(apacJob.location?.includes("Singapore"));
  assert.ok(apacJob.timezoneOffsets?.includes(8));
  assert.ok(apacJob.timezoneOffsets?.includes(10));
});

test("geo filter: a location overrides the source's UTC+14 sentinel", async () => {
  const body = JSON.stringify({
    jobs: [
      {
        title: "US-only Sentinel",
        companyName: "SentinelCo",
        guid: "https://himalayas.app/companies/sentinelco/jobs/us-sentinel",
        applicationLink: "https://himalayas.app/jobs/us-sentinel",
        pubDate: recent(1),
        categories: ["Engineering"],
        excerpt: "US only",
        locationRestrictions: ["United States"],
        // Himalayas closes US-only lists with a UTC+14 sentinel; resolving the
        // location must drop it, or an Asian reader sees the job at wide tolerances.
        timezoneRestrictions: [-8, -7, -6, -5, 14],
      },
      {
        title: "No Location, Source Offsets",
        companyName: "BareCo",
        guid: "https://himalayas.app/companies/bareco/jobs/bare",
        applicationLink: "https://himalayas.app/jobs/bare",
        pubDate: recent(2),
        categories: ["Engineering"],
        excerpt: "no location",
        timezoneRestrictions: [7, 8],
      },
    ],
  });
  // Only Himalayas is swapped; the other sources keep their valid fixtures.
  const fetchImpl = (url) => {
    const key = Object.keys(SOURCES).find((k) => SOURCES[k].url.startsWith(url.split("?")[0]));
    return Promise.resolve({
      ok: true,
      status: 200,
      text: async () => (key === "himalayas" ? body : geoBody[key] || ""),
    });
  };
  const jobs = await collectJobs({ fetchImpl });

  const sentinel = jobs.find((j) => j.title === "US-only Sentinel");
  assert.ok(sentinel.timezoneOffsets.includes(-5));
  assert.ok(!sentinel.timezoneOffsets.includes(14), `sentinel survived: ${sentinel.timezoneOffsets}`);

  // Nothing to resolve: the source's own offsets stand.
  const bare = jobs.find((j) => j.title === "No Location, Source Offsets");
  assert.deepEqual(bare.timezoneOffsets, [7, 8]);
});

test("geo filter: jobicy jobs have location from jobGeo", async () => {
  const jobs = await collectJobs({ fetchImpl: geoFetch });
  const jobicyJobs = jobs.filter((j) => j.source === "jobicy");

  assert.equal(jobicyJobs.length, 2);

  const worldwideJob = jobicyJobs.find((j) => j.title === "Worldwide Role");
  assert.equal(worldwideJob.location, "Worldwide");

  const usJob = jobicyJobs.find((j) => j.title === "US Role");
  assert.equal(usJob.location, "USA");
});

test("geo filter: wwr jobs extract location from description", async () => {
  const jobs = await collectJobs({ fetchImpl: geoFetch });
  const wwrJobs = jobs.filter((j) => j.source === "wwr");

  assert.equal(wwrJobs.length, 2);

  const usJob = wwrJobs.find((j) => j.company === "Epsilon");
  assert.ok(usJob.location?.toLowerCase().includes("us"));

  const ukJob = wwrJobs.find((j) => j.company === "Zeta");
  assert.ok(ukJob.location?.toLowerCase().includes("london") || ukJob.location?.toLowerCase().includes("uk"));
});

test("geo filter: other sources have location field", async () => {
  const jobs = await collectJobs({ fetchImpl: geoFetch });

  const remoteokJob = jobs.find((j) => j.source === "remoteok");
  assert.equal(remoteokJob?.location, "Worldwide");

  const remotiveJob = jobs.find((j) => j.source === "remotive");
  assert.equal(remotiveJob?.location, "Worldwide");

  const arbeitnowJob = jobs.find((j) => j.source === "arbeitnow");
  assert.ok(arbeitnowJob?.location?.includes("Berlin"));

  const workingnomadsJob = jobs.find((j) => j.source === "workingnomads");
  assert.equal(workingnomadsJob?.location, "Worldwide");

  const jobspressoJob = jobs.find((j) => j.source === "jobspresso");
  assert.ok(jobspressoJob?.location?.includes("United States"));

  const nodeskJob = jobs.find((j) => j.source === "nodesk");
  assert.ok(nodeskJob.location === null || nodeskJob.location === undefined);

  const dribbbleJob = jobs.find((j) => j.source === "dribbble");
  assert.ok(dribbbleJob.location === null || dribbbleJob.location === undefined);
});
