#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function buildCanon(groups) {
  const canon = new Map();
  for (const [canonical, ...aliases] of groups) {
    for (const w of [canonical, ...aliases]) {
      canon.set(w, canonical);
    }
  }
  return canon;
}

function buildPhrases(canon) {
  return [...canon.keys()]
    .filter((w) => w.includes(" "))
    .sort((a, b) => b.length - a.length)
    .map((w) => [w, canon.get(w)]);
}

function formatArray(arr) {
  return `[\n${arr.map((v) => `  ${JSON.stringify(v)},`).join("\n")}\n]`;
}

function formatValue(v) {
  if (Array.isArray(v)) {
    return `[${v.map((x) => JSON.stringify(x)).join(", ")}]`;
  }
  return JSON.stringify(v);
}

function formatInnerArray(arr) {
  return `[${arr.map(formatValue).join(", ")}]`;
}

function formatObjectArray(arr) {
  return `[\n${arr.map((v) => `  ${formatInnerArray(v)},`).join("\n")}\n]`;
}

export function generateRolesCode(config) {
  const roles = config.roles.filter((r) => r.id !== "other");
  const roleLabels = roles.map((r) => r.label);
  const roleIds = roles.map((r) => r.id);
  const roleAliases = roles.map((r) => [r.id, r.aliases || []]);

  const groups = config.groups || [];
  const canon = buildCanon(groups);
  const phrases = buildPhrases(canon);

  return `// Generated automatically from scripts/roles.json by scripts/generate-roles.mjs - DO NOT EDIT MANUALLY.

export const ROLES = ${formatArray(roleLabels)};

export const ROLE_IDS = ${formatArray(roleIds)};

export const ROLE_EXTRA_ALIASES = ${formatObjectArray(roleAliases)};

export const GROUPS = ${formatObjectArray(groups)};

export const CANON = ${formatObjectArray([...canon.entries()])};

export const PHRASES = ${formatObjectArray(phrases)};
`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const config = JSON.parse(readFileSync(new URL("./roles.json", import.meta.url), "utf8"));
  const code = generateRolesCode(config);
  writeFileSync(new URL("../site/roles.mjs", import.meta.url), code, "utf8");
}
