import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are off, so Testing Library's automatic cleanup must be registered by hand.
afterEach(() => cleanup());

// Async queries wait up to 1 s by default, which is too tight when many suites run in parallel.
configure({ asyncUtilTimeout: 5000 });

// MFA is enforced by default; the many tests that are not about MFA run with it off.
process.env.MFA_ENFORCEMENT ??= "off";
