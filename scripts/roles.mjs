// Pure role-label merge logic. No model, no I/O beyond reading the taxonomy file,
// so `node --test` can drive every decision the CI classifier makes.
import { readFileSync } from "node:fs";

export const ROLE_CONFIG = JSON.parse(readFileSync(new URL("./roles.json", import.meta.url), "utf8"));

/** A posting is only reusable when the feed still reports the same job. */
export function samePosting(a, b) {
  return Boolean(a && b) && a.id === b.id && a.title === b.title && a.company === b.company;
}

/** A model answer only becomes a role when it cleared the threshold and is not `other`. */
export function pickRole(prediction, threshold = ROLE_CONFIG.threshold) {
  if (!prediction || prediction.abstained) return null;
  if (prediction.role === "other") return null;
  const confidence = Number(prediction.confidence);
  if (!Number.isFinite(confidence) || confidence < threshold) return null;
  return { role: prediction.role, roleConfidence: confidence };
}

/**
 * Previous result wins for an unchanged posting: the CI cache key already scopes it
 * to this model revision, taxonomy version and threshold. A re-prediction is only
 * needed when the title, company or id changed.
 */
export function resolveRole(job, previous, prediction, threshold = ROLE_CONFIG.threshold) {
  if (samePosting(job, previous)) {
    return previous.role ? { role: previous.role, roleConfidence: previous.roleConfidence } : {};
  }
  return pickRole(prediction, threshold) ?? {};
}

/**
 * Merge cached and fresh answers into the fetched list. Jobs without a confident
 * answer keep no `role` field, so the page falls back to keyword ranking.
 */
export function applyRoles(jobs, previousJobs = [], predictions = {}, threshold = ROLE_CONFIG.threshold) {
  const previous = new Map(previousJobs.map((job) => [job.id, job]));
  return jobs.map((job) => {
    const { role, roleConfidence } = resolveRole(job, previous.get(job.id), predictions[job.id], threshold);
    const merged = { ...job };
    delete merged.role;
    delete merged.roleConfidence;
    if (role) {
      merged.role = role;
      merged.roleConfidence = roleConfidence;
    }
    return merged;
  });
}
