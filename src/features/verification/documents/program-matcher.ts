export type CatalogProgram = {
  id: string;
  institutionId: string;
  names: string[]; // official English and French names plus approved aliases
  classification: "direct_entry_professional" | "pre_professional" | "general_health" | "research";
};

/** Lower-case, accent-free, punctuation-free, single-spaced. Case, accents and hyphens never decide a match. */
export const normalizeName = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export type ProgramMatch = { programId: string | null; reason: "exact" | "none" | "ambiguous" | "wrong_institution" };

/**
 * Exact match of the whole program string against this institution's reviewed catalogue. A keyword
 * ("medicine", "santé", a career goal in a paragraph) never matches, and a related program such as
 * "Sciences biomédicales" can never become "Médecine": only equality of the normalized full name counts.
 */
export function matchProgram(extracted: string | null, institutionId: string, catalogue: CatalogProgram[]): ProgramMatch {
  if (!extracted) return { programId: null, reason: "none" };
  const wanted = normalizeName(extracted);
  if (!wanted) return { programId: null, reason: "none" };
  const hits = catalogue.filter((p) => p.names.some((n) => normalizeName(n) === wanted));
  if (hits.length === 0) return { programId: null, reason: "none" };
  const here = hits.filter((p) => p.institutionId === institutionId);
  if (here.length === 0) return { programId: null, reason: "wrong_institution" };
  if (new Set(here.map((p) => p.id)).size > 1) return { programId: null, reason: "ambiguous" };
  return { programId: here[0].id, reason: "exact" };
}

/** Person-name comparison: accents, case, order and hyphens are tolerated; anything else is for a reviewer. */
export function compareNames(documentName: string | null, memberName: string | null): "matched" | "mismatch" | "ambiguous" {
  if (!documentName || !memberName) return "ambiguous";
  const tokens = (s: string) => normalizeName(s).split(" ").filter(Boolean).sort().join(" ");
  const a = tokens(documentName);
  const b = tokens(memberName);
  if (a === b) return "matched";
  const sa = new Set(a.split(" "));
  const sb = new Set(b.split(" "));
  const overlap = [...sa].filter((t) => sb.has(t)).length;
  // Sharing some names (a middle name added or dropped) is ambiguous, not a match; no overlap is a mismatch.
  return overlap >= 2 ? "ambiguous" : "mismatch";
}
