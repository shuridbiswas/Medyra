/**
 * Secret scan of tracked (or staged/given) files. Dependency-free, deterministic, CI-safe.
 *   node scripts/engineering/secret-scan.ts            # every tracked file
 *   node scripts/engineering/secret-scan.ts a.ts b.ts  # specific files
 * Prints file:line and the rule name only, never the matched value. Exit 1 on any finding.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";

export const RULES: { name: string; re: RegExp }[] = [
  { name: "supabase-personal-access-token", re: /\bsbp_[A-Za-z0-9]{20,}/ },
  { name: "supabase-secret-key", re: /\bsb_secret_[A-Za-z0-9_-]{16,}/ },
  { name: "service-role-jwt", re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+/ },
  { name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "openai-style-key", re: /\bsk-(proj-)?[A-Za-z0-9]{32,}/ },
  { name: "resend-key", re: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/ },
  { name: "github-token", re: /\b(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}/ },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "private-key-block", re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "sentry-auth-token", re: /\bsntrys_[A-Za-z0-9_=+/-]{20,}/ },
  { name: "upstash-token-assignment", re: /UPSTASH_REDIS_REST_TOKEN\s*=\s*["']?[A-Za-z0-9=_-]{20,}/ },
];

/** Env files that must never be tracked, whatever they contain. */
const FORBIDDEN_FILES = /(^|\/)\.env(\.[a-z]+)?(\.local)?$/;
const ALLOWED_ENV = /(^|\/)\.env\.example$/;

export function scanText(file: string, text: string): string[] {
  const findings: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const rule of RULES) if (rule.re.test(line)) findings.push(`${file}:${i + 1} ${rule.name}`);
  });
  return findings;
}

function trackedFiles(): string[] {
  const r = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("git ls-files failed");
  return r.stdout.split("\0").filter(Boolean);
}

function main() {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : trackedFiles();
  const findings: string[] = [];
  for (const f of files) {
    const norm = f.replace(/\\/g, "/");
    if (FORBIDDEN_FILES.test(norm) && !ALLOWED_ENV.test(norm)) {
      findings.push(`${norm} tracked-env-file`);
      continue;
    }
    if (!existsSync(f) || statSync(f).size > 2_000_000 || /\.(png|jpe?g|gif|webp|ico|woff2?|pdf|mp4|mp3|wav|lut|cube)$/i.test(f)) continue;
    findings.push(...scanText(norm, readFileSync(f, "utf8")));
  }
  if (findings.length) {
    console.error(`secret scan: ${findings.length} finding(s)\n${findings.join("\n")}`);
    process.exit(1);
  }
  console.log(`secret scan: ${files.length} files, no findings`);
}

if (process.argv[1]?.endsWith("secret-scan.ts")) main();
