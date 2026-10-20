#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

export function generateRolesCode(config) {
  const roles = config.roles.filter((r) => r.id !== "other");
  const roleLabels = roles.map((r) => r.label);
  const roleIds = roles.map((r) => r.id);
  const roleAliases = roles.map((r) => [r.id, r.aliases || []]);

  return `// Generated automatically from scripts/roles.json by scripts/generate-roles.mjs - DO NOT EDIT MANUALLY.

export const ROLES = ${JSON.stringify(roleLabels, null, 2)};

export const ROLE_IDS = ${JSON.stringify(roleIds, null, 2)};

export const ROLE_EXTRA_ALIASES = ${JSON.stringify(roleAliases, null, 2)};
`;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const config = JSON.parse(readFileSync(new URL("./roles.json", import.meta.url), "utf8"));
  const code = generateRolesCode(config);
  writeFileSync(new URL("../site/roles.mjs", import.meta.url), code, "utf8");
}
