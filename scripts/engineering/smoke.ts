/**
 * HTTP smoke test of a deployed Medyra site (preview or production). Read-only GET requests;
 * never signs in, never sends member data.
 *   node scripts/engineering/smoke.ts <base-url> [--expect-env preview|production] [--json]
 * Exit 1 if any check fails. A passing smoke test is necessary, not sufficient, for a release.
 */
type Check = { name: string; ok: boolean; detail: string };

async function get(url: string) {
  const res = await fetch(url, { redirect: "manual", headers: { "user-agent": "medyra-smoke/1" } });
  return { status: res.status, location: res.headers.get("location") ?? "", headers: res.headers, text: res.status < 300 ? await res.text() : "" };
}

export async function smoke(base: string, expectEnv?: string): Promise<Check[]> {
  const u = (p: string) => new URL(p, base).toString();
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const health = await get(u("/api/health"));
  let body: { status?: string; environment?: string; services?: Record<string, unknown> } = {};
  try {
    body = JSON.parse(health.text);
  } catch {
    // reported below
  }
  add("health responds 200 ok", health.status === 200 && body.status === "ok", `HTTP ${health.status}, status=${body.status}`);
  const booleansOnly = body.services ? Object.values(body.services).every((v) => typeof v === "boolean") : false;
  add("health exposes booleans only", booleansOnly, body.services ? Object.keys(body.services).join(",") : "no services object");
  if (expectEnv) add(`environment is ${expectEnv}`, body.environment === expectEnv, `reported ${body.environment}`);
  add("health is not cached", (health.headers.get("cache-control") ?? "").includes("no-store"), health.headers.get("cache-control") ?? "none");

  const home = await get(u("/"));
  add("signed-out / redirects to /welcome", home.status >= 300 && home.status < 400 && home.location.includes("/welcome"), `${home.status} → ${home.location}`);
  const welcome = await get(u("/welcome"));
  add("/welcome renders", welcome.status === 200 && welcome.text.includes("Medyra"), `HTTP ${welcome.status}`);
  for (const p of ["/settings", "/messages", "/admin"]) {
    const r = await get(u(p));
    add(`signed-out ${p} redirects to login`, r.status >= 300 && r.status < 400 && r.location.includes("/login"), `${r.status} → ${r.location}`);
  }
  for (const h of ["strict-transport-security", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy"]) {
    add(`header ${h}`, welcome.headers.has(h), welcome.headers.get(h) ?? "missing");
  }
  const sentry = await get(u("/api/sentry-test"));
  add("sentry test route closed without token", sentry.status === 404, `HTTP ${sentry.status}`);
  return checks;
}

async function main() {
  const base = process.argv[2];
  if (!base || !/^https?:\/\//.test(base)) {
    console.error("usage: smoke.ts <https://site> [--expect-env preview|production] [--json]");
    process.exit(2);
  }
  const i = process.argv.indexOf("--expect-env");
  const checks = await smoke(base, i > 0 ? process.argv[i + 1] : undefined);
  const failed = checks.filter((c) => !c.ok);
  if (process.argv.includes("--json")) console.log(JSON.stringify({ base, passed: failed.length === 0, checks }, null, 2));
  else for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}  (${c.detail})`);
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1]?.endsWith("smoke.ts")) main();
