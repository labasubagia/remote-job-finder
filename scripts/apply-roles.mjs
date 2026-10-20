#!/usr/bin/env node
// Merge cached and freshly predicted roles into the fetched list, then keep the
// merged list for the next run's cache. Generated output only; never committed.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { applyRoles } from "./roles.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1) {
    const value = process.argv[i + 1];
    if (!value) throw new Error(`--${name} needs a path`);
    return value;
  }
  const envName = `RJF_${name.toUpperCase().replace(/-/g, "_")}_PATH`;
  return process.env[envName] ?? fallback;
};
const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    return fallback;
  }
};

const jobsPath = resolve(arg("jobs", "site/jobs.json"));
const previousPath = resolve(arg("previous", ".cache/previous-jobs.json"));
const predictionsPath = resolve(arg("predictions", ".cache/role-predictions.json"));

const jobs = await readJson(jobsPath, null);
if (!Array.isArray(jobs)) throw new Error(`${jobsPath}: expected a JSON array`);
const previousRaw = await readJson(previousPath, []);
const previous = Array.isArray(previousRaw) ? previousRaw : [];
const predictionsRaw = await readJson(predictionsPath, {});
const predictions =
  predictionsRaw && typeof predictionsRaw === "object" && !Array.isArray(predictionsRaw) ? predictionsRaw : {};

const merged = applyRoles(jobs, previous, predictions);
const withRole = merged.filter((job) => job.role).length;
const prevKeys = new Set(
  (Array.isArray(previous) ? previous : [])
    .filter((old) => old && typeof old === "object" && typeof old.id === "string" && typeof old.title === "string")
    .map((old) => `${old.id}\0${old.title}`),
);
const cached = merged.filter((job) => prevKeys.has(`${job.id}\0${job.title}`)).length;

await writeFile(jobsPath, JSON.stringify(merged));
await mkdir(dirname(previousPath), { recursive: true });
await writeFile(previousPath, JSON.stringify(merged));
console.error(
  `roles: ${withRole}/${merged.length} labelled, ${cached} reused, ${Object.keys(predictions).length} predicted`,
);
