#!/usr/bin/env node
// Aggregate remote-only jobs from 5 public sources into one JSON array.
// Zero dependencies. Runs on an Actions runner (or locally); never in a browser,
// because most sources send no CORS headers.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const UA = "remote-job-finder/0.1 (+https://github.com/remote-job-finder)";
const ATTEMPTS = 3;
const TIMEOUT_MS = 20_000;
const MAX_EXCERPT = 200;
const MAX_AGE_DAYS = 30;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Error that must turn the Actions run red instead of being retried or papered over. */
export class FatalSourceError extends Error {}
const fail = (source, why) => new FatalSourceError(`${source}: ${why}`);

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

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const stripHtml = (s = "") =>
  decode(String(s).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

const excerpt = (s) => {
  const t = stripHtml(s);
  return t.length > MAX_EXCERPT ? `${t.slice(0, MAX_EXCERPT - 1).trimEnd()}…` : t;
};

/** epoch seconds | ISO | RFC-822 -> ISO string, or null when unparseable. */
const iso = (v) => {
  if (v == null || v === "") return null;
  let s = String(v).trim();
  if (/^\d+$/.test(s)) return new Date(Number(s) * 1000).toISOString();
  // ponytail: sources that omit a timezone are treated as UTC; revisit if a source proves otherwise
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(s)) s = `${s.replace(" ", "T")}Z`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

const tags = (v) =>
  (Array.isArray(v) ? v : v ? [v] : [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, 8);

export const SOURCES = {
  remoteok: {
    url: "https://remoteok.com/api",
    parse(text) {
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw fail("remoteok", "expected a JSON array (schema changed?)");
      // data[0] is the legal notice, not a job
      return data
        .filter((j) => j && j.id && j.position)
        .map((j) => ({
          id: `remoteok-${j.id}`,
          title: j.position,
          company: j.company ?? "",
          url: j.url || j.apply_url || `https://remoteok.com/remote-jobs/${j.slug}`,
          source: "remoteok",
          tags: tags(j.tags),
          postedAt: iso(j.date ?? j.epoch),
          excerpt: excerpt(j.description),
        }));
    },
  },
  remotive: {
    url: "https://remotive.com/api/remote-jobs",
    parse(text) {
      const jobs = JSON.parse(text)?.jobs;
      if (!Array.isArray(jobs)) throw fail("remotive", "missing jobs[] (schema changed?)");
      return jobs.map((j) => ({
        id: `remotive-${j.id}`,
        title: j.title,
        company: j.company_name ?? "",
        url: j.url,
        source: "remotive",
        tags: tags(j.tags),
        postedAt: iso(j.publication_date),
        excerpt: excerpt(j.description),
      }));
    },
  },
  arbeitnow: {
    url: "https://www.arbeitnow.com/api/job-board-api",
    parse(text) {
      const jobs = JSON.parse(text)?.data;
      if (!Array.isArray(jobs)) throw fail("arbeitnow", "missing data[] (schema changed?)");
      return jobs
        .filter((j) => j?.remote === true) // board mixes onsite jobs; keep remote only
        .map((j) => ({
          id: `arbeitnow-${j.slug}`,
          title: j.title,
          company: j.company_name ?? "",
          url: j.url,
          source: "arbeitnow",
          tags: tags(j.tags),
          postedAt: iso(j.created_at),
          excerpt: excerpt(j.description),
        }));
    },
  },
  himalayas: {
    url: "https://himalayas.app/jobs/api?limit=100",
    parse(text) {
      const jobs = JSON.parse(text)?.jobs;
      if (!Array.isArray(jobs)) throw fail("himalayas", "missing jobs[] (schema changed?)");
      return jobs.map((j) => {
        const guid = String(j.guid ?? "");
        return {
          id: `himalayas-${guid.split("/").filter(Boolean).pop() || j.companySlug || j.title}`,
          title: j.title,
          company: j.companyName ?? "",
          url: j.applicationLink || guid,
          source: "himalayas",
          tags: tags(j.categories),
          postedAt: iso(j.pubDate),
          excerpt: excerpt(j.excerpt),
        };
      });
    },
  },
  wwr: {
    url: "https://weworkremotely.com/categories/remote-programming-jobs.rss",
    parse(text) {
      const items = text.match(/<item>[\s\S]*?<\/item>/g);
      if (!items?.length) throw fail("wwr", "no <item> in RSS (feed changed?)");
      return items.map((raw) => {
        const pick = (re) => decode((raw.match(re)?.[1] ?? "").trim());
        const link = pick(/<link>([\s\S]*?)<\/link>/) || pick(/<guid[^>]*>([\s\S]*?)<\/guid>/);
        if (!link) throw fail("wwr", "item without link");
        const full = pick(/<title>([\s\S]*?)<\/title>/);
        const [head, ...rest] = full.split(/:\s*/);
        const slug = link.split("/").filter(Boolean).pop();
        return {
          id: `wwr-${slug}`,
          title: rest.join(": ") || full,
          company: rest.length ? head : "",
          url: link,
          source: "wwr",
          tags: tags(pick(/<category>([\s\S]*?)<\/category>/)),
          postedAt: iso(pick(/<pubDate>([\s\S]*?)<\/pubDate>/)),
          excerpt: excerpt(pick(/<description>([\s\S]*?)<\/description>/)),
        };
      });
    },
  },
};

export async function collectJobs({
  fetchImpl = fetch,
  now = Date.now(),
  maxAgeDays = MAX_AGE_DAYS,
  log = () => {},
} = {}) {
  const cutoff = now - maxAgeDays * 86_400_000;
  const collected = [];
  for (const [name, source] of Object.entries(SOURCES)) {
    const parsed = source.parse(await fetchText(name, source.url, { fetchImpl }));
    const fresh = parsed.filter((j) => j.postedAt && Date.parse(j.postedAt) >= cutoff);
    if (fresh.length === 0) {
      throw fail(name, `0 of ${parsed.length} jobs newer than ${maxAgeDays}d — check the source before publishing`);
    }
    log(`${name}: ${parsed.length} parsed, ${fresh.length} kept (${maxAgeDays}d window)`);
    collected.push(...fresh);
  }
  const unique = new Map(collected.map((j) => [j.id, j]));
  return [...unique.values()].sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}

async function main(argv) {
  const at = argv.indexOf("--out");
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
