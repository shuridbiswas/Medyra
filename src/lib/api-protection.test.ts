// @vitest-environment node
//
// Every HTTP route handler in the app must be listed here with how it is protected. Adding a route
// without deciding that makes this test fail, so an unprotected endpoint cannot appear by accident.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appDir = path.resolve(import.meta.dirname, "../app");

const ROUTES: Record<string, { protection: string; mustContain: string[] }> = {
  "api/health/route.ts": {
    protection: "public by design; returns presence booleans only, never values",
    mustContain: ["serviceStatus"],
  },
  "api/sentry-test/route.ts": {
    protection: "404 unless a server token is configured and sent",
    mustContain: ["SENTRY_TEST_TOKEN", "status: 404"],
  },
  "auth/callback/route.ts": {
    protection: "public by design (email links); validates the code and only redirects to safe paths",
    mustContain: ["safeNextPath"],
  },
  "api/verification/providers/sheerid/webhook/route.ts": {
    protection: "public by design (SheerID calls it); authorised only by an HMAC signature over the raw body, checked in processSheerIdWebhook",
    mustContain: ["processSheerIdWebhook", "x-sheerid-signature", "no-store"],
  },
  "api/verification/student/return/route.ts": {
    protection: "signed-in member only; the state must match an attempt that member started; the ID token is fully validated in processSsoCallback",
    mustContain: ["requireMember", "processSsoCallback", "no-store"],
  },
  "settings/privacy/export/route.ts": {
    protection: "signed-in member only, recent sign-in, POST only, rate limited, never cached",
    mustContain: ["requireMember", "isRecentAuth", "checkRateLimit", "no-store", "405"],
  },
};

function routeFiles(dir: string, base = ""): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    const rel = path.posix.join(base, entry);
    if (statSync(full).isDirectory()) return routeFiles(full, rel);
    return entry === "route.ts" || entry === "route.tsx" ? [rel] : [];
  });
}

describe("HTTP route handlers", () => {
  const found = routeFiles(appDir);

  it("are all accounted for (a new route must be added to this list with its protection)", () => {
    expect(found.sort()).toEqual(Object.keys(ROUTES).sort());
  });

  it.each(Object.entries(ROUTES))("%s is protected as documented", (file, { mustContain }) => {
    const source = readFileSync(path.join(appDir, file), "utf8");
    for (const needle of mustContain) expect(source, `${file} should contain ${needle}`).toContain(needle);
  });

  it("never exposes a route that returns member data without a session check", () => {
    for (const file of found) {
      const source = readFileSync(path.join(appDir, file), "utf8");
      if (/\.from\("/.test(source) || /exportMemberData/.test(source)) {
        expect(source, file).toMatch(/requireMember|requireUser|requireAdmin/);
      }
    }
  });
});

describe("server actions", () => {
  it("every exported server action file validates who is calling before touching data", () => {
    const featuresDir = path.resolve(import.meta.dirname, "../features");
    const actionFiles = readdirSync(featuresDir)
      .map((f) => path.join(featuresDir, f, "actions.ts"))
      .filter((p) => {
        try {
          return statSync(p).isFile();
        } catch {
          return false;
        }
      });
    expect(actionFiles.length).toBeGreaterThanOrEqual(8);
    // Auth actions are the sign-in flow itself; everything else must be gated.
    const gated = actionFiles.filter((p) => !p.includes(`${path.sep}auth${path.sep}`));
    for (const file of gated) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toMatch(/requireMember|requireUser|requireAdmin|requireOnboardingPending/);
    }
  });
});
