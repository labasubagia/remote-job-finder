#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

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

export function generateRolesCode(config) {
  const roles = config.roles.filter((r) => r.id !== "other");
  const roleLabels = roles.map((r) => r.label);
  const roleIds = roles.map((r) => r.id);
  const roleAliases = roles.map((r) => [r.id, r.aliases || []]);

  const groups = config.groups || [];
  const canon = buildCanon(groups);
  const phrases = buildPhrases(canon);

  return `// Generated automatically from scripts/roles.json by scripts/generate-roles.mjs - DO NOT EDIT MANUALLY.

export const ROLES = ${JSON.stringify(roleLabels, null, 2)};

export const ROLE_IDS = ${JSON.stringify(roleIds, null, 2)};

export const ROLE_EXTRA_ALIASES = ${JSON.stringify(roleAliases, null, 2)};

export const GROUPS = ${JSON.stringify(groups, null, 2)};

export const CANON = ${JSON.stringify([...canon.entries()], null, 2)};

export const PHRASES = ${JSON.stringify(phrases, null, 2)};
`;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const config = JSON.parse(readFileSync(new URL("./roles.json", import.meta.url), "utf8"));
  const code = generateRolesCode(config);
  writeFileSync(new URL("../site/roles.mjs", import.meta.url), code, "utf8");
}
