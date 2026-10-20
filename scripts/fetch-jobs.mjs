#!/usr/bin/env node
// Aggregate remote-only jobs from 5 public sources into one JSON array.
// Zero dependencies. Runs on an Actions runner (or locally); never in a browser,
// because most sources send no CORS headers.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLocationResolver } from "./timezone.mjs";

const UA = "remote-job-finder/0.1 (+https://github.com/remote-job-finder)";
const ATTEMPTS = 3;
const TIMEOUT_MS = 20_000;
const MAX_TAGS_PER_JOB = 8;
const MAX_EXCERPT = 200;
const MAX_AGE_DAYS = 30;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Error that must turn the Actions run red instead of being retried or papered over. */
export class FatalSourceError extends Error {}
const fail = (source, why) => new FatalSourceError(`${source}: ${why}`);
/** A source that returns invalid JSON is a schema change, not a parse bug in this file. */
const json = (source, text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw fail(source, "invalid JSON (feed changed?)");
  }
};

export async function fetchText(source, url, { fetchImpl = fetch, attempts = ATTEMPTS } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, {
        headers: { "user-agent": UA, accept: "application/json, application/xml, text/xml, */*" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // network error / timeout: retryable
      if (attempt === attempts) {
        throw fail(source, `network error after ${attempts} attempts: ${err?.cause?.code ?? err?.message ?? err}`);
      }
      await sleep(500 * 2 ** (attempt - 1));
      continue;
    }
    if (res.ok) return res.text();
    // 401/403/404/410/451 -> blocked, removed, or ToS changed: never retry, never hide.
    if (!RETRYABLE_STATUS.has(res.status)) {
      throw fail(source, `HTTP ${res.status} (blocked, moved, or ToS changed; not retrying — check source manually)`);
    }
    if (attempt === attempts) throw fail(source, `HTTP ${res.status} after ${attempts} attempts`);
    await sleep(500 * 2 ** (attempt - 1));
  }
}

/** Decode one numeric character reference; invalid code points become U+FFFD. */
const codePoint = (n) =>
  Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "\uFFFD";

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => codePoint(Number(dec)))
    // last, so "&amp;lt;" decodes to "&lt;" and never twice
    .replace(/&amp;/g, "&");

const stripHtml = (s = "") =>
  decode(String(s).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

const excerpt = (s) => {
  const t = stripHtml(s);
  if (t.length <= MAX_EXCERPT) return t;
  let cut = t.slice(0, MAX_EXCERPT - 1);
  // a cut between the two halves of a surrogate pair would render as U+FFFD
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
};

/** epoch seconds | epoch millis | ISO | RFC-822 -> ISO string, or null when unparseable or out of range. */
const iso = (v) => {
  if (v == null || v === "") return null;
  let s = String(v).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    // 1e11 seconds is year 5138; real millisecond epochs are ~1e12, so anything that large is millis.
    const d = new Date(n >= 1e11 ? n : n * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // ponytail: sources that omit a timezone are treated as UTC; revisit if a source proves otherwise
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(s)) s = `${s.replace(" ", "T")}Z`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/** Only http(s) links are rendered as anchors, so anything else is dropped before publishing. */
const isHttpUrl = (v) => /^https?:\/\/\S+$/i.test(String(v ?? "").trim());

const tags = (v) =>
  (Array.isArray(v) ? v : v ? [v] : [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, MAX_TAGS_PER_JOB);

/** RSS 2.0 <item> blocks; a feed that renames its items is a schema change, not an empty day. */
const rssItems = (source, text) => {
  const items = text.match(/<item\b[^>]*>[\s\S]*?<\/item>/g);
  if (!items?.length) throw fail(source, "no <item> in RSS (feed changed?)");
  return items;
};

/** First occurrence of an RSS element in one <item>, decoded; "" when the feed omits it. */
const field = (raw, name) =>
  decode(String(raw.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? "").trim());

export const SOURCES = {
  remoteok: {
    url: "https://remoteok.com/api",
    parse(text) {
      const data = json("remoteok", text);
      if (!Array.isArray(data)) throw fail("remoteok", "expected a JSON array (schema changed?)");
      // data[0] is the legal notice, not a job
      return data
        .filter((j) => j?.id && j.position)
        .map((j) => {
          const location = String(j.location ?? "").trim() || null;
          return {
            id: `remoteok-${j.id}`,
            title: j.position,
            company: j.company ?? "",
            url: j.url || j.apply_url || `https://remoteok.com/remote-jobs/${j.slug}`,
            source: "remoteok",
            tags: tags(j.tags),
            postedAt: iso(j.date ?? j.epoch),
            excerpt: excerpt(j.description),
            location,
          };
        });
    },
  },
  remotive: {
    url: "https://remotive.com/api/remote-jobs",
    parse(text) {
      const jobs = json("remotive", text)?.jobs;
      if (!Array.isArray(jobs)) throw fail("remotive", "missing jobs[] (schema changed?)");
      return jobs.map((j) => {
        const location = String(j.candidate_required_location ?? "").trim() || null;
        return {
          id: `remotive-${j.id}`,
          title: j.title,
          company: j.company_name ?? "",
          url: j.url,
          source: "remotive",
          tags: tags(j.tags),
          postedAt: iso(j.publication_date),
          excerpt: excerpt(j.description),
          location,
        };
      });
    },
  },
  arbeitnow: {
    url: "https://www.arbeitnow.com/api/job-board-api",
    parse(text) {
      const jobs = json("arbeitnow", text)?.data;
      if (!Array.isArray(jobs)) throw fail("arbeitnow", "missing data[] (schema changed?)");
      return jobs
        .filter((j) => j?.remote === true) // board mixes onsite jobs; keep remote only
        .map((j) => {
          const location = String(j.location ?? "").trim() || null;
          return {
            id: `arbeitnow-${j.slug}`,
            title: j.title,
            company: j.company_name ?? "",
            url: j.url,
            source: "arbeitnow",
            tags: tags(j.tags),
            postedAt: iso(j.created_at),
            excerpt: excerpt(j.description),
            location,
          };
        });
    },
  },
  himalayas: {
    url: "https://himalayas.app/jobs/api?limit=100",
    parse(text) {
      const jobs = json("himalayas", text)?.jobs;
      if (!Array.isArray(jobs)) throw fail("himalayas", "missing jobs[] (schema changed?)");
      return jobs.map((j) => {
        const guid = String(j.guid ?? "");
        const location =
          Array.isArray(j.locationRestrictions) && j.locationRestrictions.length
            ? j.locationRestrictions.join(", ")
            : null;
        const timezoneOffsets =
          Array.isArray(j.timezoneRestrictions) && j.timezoneRestrictions.length ? j.timezoneRestrictions : null;
        return {
          id: `himalayas-${guid.split("/").filter(Boolean).pop() || j.companySlug || j.title}`,
          title: j.title,
          company: j.companyName ?? "",
          url: j.applicationLink || guid,
          source: "himalayas",
          tags: tags(j.categories),
          postedAt: iso(j.pubDate),
          excerpt: excerpt(j.excerpt),
          location,
          timezoneOffsets,
        };
      });
    },
  },
  wwr: {
    url: "https://weworkremotely.com/categories/remote-programming-jobs.rss",
    parse(text) {
      return rssItems("wwr", text).map((raw) => {
        const link = field(raw, "link") || field(raw, "guid");
        if (!link) throw fail("wwr", "item without link");
        const full = field(raw, "title");
        const [head, ...rest] = full.split(/:\s*/);
        const slug = link.split("/").filter(Boolean).pop();
        const desc = field(raw, "description");
        const locMatch = desc.match(/<strong>Headquarters:<\/strong>\s*([^<\n]+)/i);
        const location = locMatch ? locMatch[1].trim() : null;
        return {
          id: `wwr-${slug}`,
          title: rest.join(": ") || full,
          company: rest.length ? head : "",
          url: link,
          source: "wwr",
          tags: tags(field(raw, "category")),
          postedAt: iso(field(raw, "pubDate")),
          excerpt: excerpt(desc),
          location,
        };
      });
    },
  },
  jobicy: {
    url: "https://jobicy.com/api/v2/remote-jobs?count=50",
    parse(text) {
      const jobs = json("jobicy", text)?.jobs;
      if (!Array.isArray(jobs)) throw fail("jobicy", "missing jobs[] (schema changed?)");
      return jobs.map((j) => {
        const location = String(j.jobGeo ?? "").trim() || null;
        return {
          id: `jobicy-${j.id}`,
          title: j.jobTitle,
          company: j.companyName ?? "",
          url: j.url,
          source: "jobicy",
          // jobIndustry already reads like the role chips: "Software Engineering", "Data Science & Analytics"
          tags: tags(j.jobIndustry),
          postedAt: iso(j.pubDate),
          excerpt: excerpt(j.jobExcerpt || j.jobDescription),
          location,
        };
      });
    },
  },
  workingnomads: {
    url: "https://www.workingnomads.com/api/exposed_jobs/",
    parse(text) {
      const jobs = json("workingnomads", text);
      if (!Array.isArray(jobs)) throw fail("workingnomads", "expected a JSON array (schema changed?)");
      return jobs.map((j) => {
        const path = String(j.url ?? "");
        const location = String(j.location ?? "").trim() || null;
        return {
          id: `workingnomads-${path.split("/").filter(Boolean).pop() || j.title}`,
          title: j.title,
          company: j.company_name ?? "",
          url: j.url,
          source: "workingnomads",
          // tags arrive as one comma-separated string; category_name is the closest thing to a role
          tags: tags([j.category_name, ...String(j.tags ?? "").split(",")]),
          postedAt: iso(j.pub_date),
          excerpt: excerpt(j.description),
          location,
        };
      });
    },
  },
  nodesk: {
    url: "https://nodesk.co/remote-jobs/index.xml",
    parse(text) {
      return rssItems("nodesk", text).map((raw) => {
        // titles are "Role at Company"
        const full = field(raw, "title");
        const at = full.lastIndexOf(" at ");
        const link = field(raw, "link");
        if (!link) throw fail("nodesk", "item without link");
        return {
          id: `nodesk-${link.split("/").filter(Boolean).pop()}`,
          title: at > 0 ? full.slice(0, at) : full,
          company: at > 0 ? full.slice(at + 4) : "",
          url: link,
          source: "nodesk",
          tags: [],
          postedAt: iso(field(raw, "pubDate")),
          excerpt: excerpt(field(raw, "description")),
        };
      });
    },
  },
  jobspresso: {
    url: "https://jobspresso.co/feed/?post_type=job_listing",
    parse(text) {
      return rssItems("jobspresso", text).map((raw) => {
        const link = field(raw, "link");
        if (!link) throw fail("jobspresso", "item without link");
        // dc:creator carries "Company<br>⚲ Location"; the company is everything before the break
        const creatorParts = field(raw, "dc:creator").split(/<br\s*\/?>/i);
        const company = stripHtml(creatorParts[0]);
        const location = creatorParts[1]?.replace(/^⚲\s*/, "").trim() || null;
        return {
          id: `jobspresso-${link.split("/").filter(Boolean).pop()}`,
          title: field(raw, "title"),
          company,
          url: link,
          source: "jobspresso",
          tags: [],
          postedAt: iso(field(raw, "pubDate")),
          excerpt: excerpt(field(raw, "description")),
          location,
        };
      });
    },
  },
  dribbble: {
    url: "https://dribbble.com/jobs.rss",
    parse(text) {
      return rssItems("dribbble", text).flatMap((raw) => {
        // "Company is hiring for a position of Role in Location"; the feed also carries onsite roles
        const m = field(raw, "title").match(/^(.+?) is hiring for a position of (.+?) in (.+)$/);
        const link = field(raw, "link");
        if (!m || !link) return [];
        const [, company, title, place] = m;
        if (!/^remote\b/i.test(place)) return [];
        const slug = link.split("?")[0].split("/").filter(Boolean).pop();
        return [
          {
            id: `dribbble-${slug}`,
            title,
            company,
            url: link,
            source: "dribbble",
            tags: [place],
            postedAt: iso(field(raw, "pubDate")),
            excerpt: excerpt(field(raw, "description")),
          },
        ];
      });
    },
  },
};

export async function fetchSource(name, source, fetchImpl) {
  const text = await fetchText(name, source.url, { fetchImpl });
  return source.parse(text);
}

function filterJobs(parsed, name, log) {
  const linked = parsed.filter((j) => isHttpUrl(j.url));
  if (linked.length < parsed.length) {
    log(`${name}: dropped ${parsed.length - linked.length} job(s) with a non-http url`);
  }
  return linked;
}

function filterFresh(linked, cutoff, name, parsedLength, log, maxAgeDays) {
  const fresh = linked.filter((j) => j.postedAt && Date.parse(j.postedAt) >= cutoff);
  if (fresh.length === 0) {
    throw fail(name, `0 of ${parsedLength} jobs newer than ${maxAgeDays}d — check the source before publishing`);
  }
  log(`${name}: ${parsedLength} parsed, ${fresh.length} kept (${maxAgeDays}d window)`);
  return fresh;
}

function deduplicateAndSort(jobs) {
  const unique = new Map(jobs.map((j) => [j.id, j]));
  return [...unique.values()].sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}

export async function collectJobs({
  fetchImpl = fetch,
  now = Date.now(),
  maxAgeDays = MAX_AGE_DAYS,
  log = () => {},
} = {}) {
  const cutoff = now - maxAgeDays * 86_400_000;

  const results = await Promise.all(
    Object.entries(SOURCES).map(async ([name, source]) => {
      const parsed = await fetchSource(name, source, fetchImpl);
      const linked = filterJobs(parsed, name, log);
      return filterFresh(linked, cutoff, name, parsed.length, log, maxAgeDays);
    }),
  );
  // Resolve every free-text location into UTC offsets while we have Node's ICU
  // data. The published file then carries numbers, and the browser only compares
  // them against the reader's clock. A location the tz database cannot place
  // leaves any offsets the source supplied untouched (null = unknown).
  const resolveLocation = createLocationResolver({ now: new Date(now) });
  const jobs = results.flat().map((job) => ({
    ...job,
    timezoneOffsets: (resolveLocation(job.location) ?? job.timezoneOffsets ?? null)?.filter(
      (n) => typeof n === "number" && Number.isFinite(n),
    ),
  }));

  return deduplicateAndSort(jobs);
}

async function main(argv) {
  const at = argv.indexOf("--out");
  if (at !== -1 && !argv[at + 1]) throw new Error("--out needs a path");
  const out = resolve(at === -1 ? "site/jobs.json" : argv[at + 1]);
  const jobs = await collectJobs({ log: (m) => console.error(m) });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(jobs));
  console.error(`wrote ${jobs.length} jobs -> ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`FAILED ${err.message}`);
    process.exit(1);
  });
}
