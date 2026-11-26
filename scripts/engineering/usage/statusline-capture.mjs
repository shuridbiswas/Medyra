#!/usr/bin/env node
// Claude Code status line command: records the documented subscription usage fields
// (rate_limits.five_hour / seven_day: used_percentage 0-100, resets_at epoch seconds)
// to a per-user snapshot file for the Medyra usage governor, then prints a short status line.
// Reads only the JSON Claude Code passes on stdin. Never reads credentials or calls any endpoint.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SNAPSHOT_PATH =
  process.env.MEDYRA_USAGE_SNAPSHOT ?? path.join(homedir(), ".medyra", "usage-snapshot.json");

function window(w) {
  if (!w || typeof w.used_percentage !== "number" || typeof w.resets_at !== "number") return null;
  return { usedPercent: w.used_percentage, resetsAt: new Date(w.resets_at * 1000).toISOString() };
}

// Usage only grows inside one window, so for the same reset time keep the higher reading:
// several sessions can report out of order and the governor must see the worst case.
export function mergeWindow(prev, next) {
  if (!next) return prev ?? null;
  if (!prev || next.resetsAt > prev.resetsAt) return next;
  if (next.resetsAt < prev.resetsAt) return prev;
  return next.usedPercent >= prev.usedPercent ? next : prev;
}

export function capture(input, prev, now = new Date()) {
  const rl = input?.rate_limits ?? null;
  const fiveHour = window(rl?.five_hour);
  const sevenDay = window(rl?.seven_day);
  if (!fiveHour && !sevenDay) return null; // not a subscriber session, or before the first response
  return {
    version: 1,
    source: "statusline",
    capturedAt: now.toISOString(),
    claudeCodeVersion: typeof input.version === "string" ? input.version : null,
    fiveHour: mergeWindow(prev?.fiveHour, fiveHour),
    sevenDay: mergeWindow(prev?.sevenDay, sevenDay),
  };
}

function readPrev() {
  try {
    return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let input = null;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stdout.write("usage: n/a");
    return;
  }
  const snap = capture(input, readPrev());
  if (snap) {
    mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
    const tmp = `${SNAPSHOT_PATH}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(snap, null, 2));
    renameSync(tmp, SNAPSHOT_PATH);
  }
  const f = snap?.fiveHour?.usedPercent, w = snap?.sevenDay?.usedPercent;
  process.stdout.write(snap ? `5h ${f ?? "?"}% · 7d ${w ?? "?"}%` : "usage: n/a");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => process.stdout.write("usage: error"));
}
