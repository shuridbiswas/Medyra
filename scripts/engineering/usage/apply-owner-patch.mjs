#!/usr/bin/env node
// Owner-only changes for the usage governor. Agents cannot edit these files (guard hook), so the
// founder runs this once from their own terminal:  node scripts/engineering/usage/apply-owner-patch.mjs
// Every change only tightens rules; running it twice changes nothing.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const file = (p) => path.join(root, p);
const edit = (p, fn) => {
  const before = readFileSync(file(p), "utf8");
  const json = JSON.parse(before);
  fn(json);
  const after = JSON.stringify(json, null, 2) + "\n";
  if (after !== before) writeFileSync(file(p), after);
  console.log(`${after === before ? "unchanged" : "updated  "} ${p}`);
};
const addAll = (arr, items) => {
  for (const i of items) if (!arr.includes(i)) arr.push(i);
};

edit("engineering/policy.json", (p) => {
  addAll(p.ownerOnlyPaths, ["engineering/governor.json"]);
  addAll(p.secretPaths, ["engineering/.local/**", "**/.medyra/**"]);
  addAll(p.forbiddenCommands, [
    "claude -p",
    "claude --print",
    "claude.exe",
    "@anthropic-ai/claude-code",
    "usage:resume",
    "usage:configure",
    "usage:run",
    "usage:tick",
    "usage/cli.ts run",
    "usage/cli.ts tick",
    "MEDYRA_OWNER_MODE",
    "ANTHROPIC_API_KEY",
  ]);
});

edit(".claude/settings.json", (s) => {
  addAll(s.permissions.deny, [
    "Read(./engineering/.local/**)",
    "Read(~/.medyra/**)",
    "Bash(claude:*)",
    "Bash(npm run usage:resume:*)",
    "Bash(npm run usage:configure:*)",
    "Bash(npm run usage:run:*)",
    "Bash(npm run usage:tick:*)",
  ]);
});

edit("engineering/control.json", (c) => {
  // Sonnet by default; Opus stays for the security reviewer and, per task, for complex security-sensitive database work.
  c.models["medyra-database-engineer"] = "sonnet";
});

console.log("Done. Review with `git diff`, then commit these files yourself.");
