/**
 * Our database functions raise readable sentences (check_violation, no_data_found, or Not allowed).
 * Those are shown; anything else (constraint names, internals) becomes one generic line.
 */
export const GENERIC_ERROR = "Something went wrong. Please try again.";

export function friendlyDbError(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return GENERIC_ERROR;
  const m = error.message ?? "";
  if (/not allowed/i.test(m) || error.code === "42501") return "You are not allowed to do that.";
  if ((error.code === "23514" || error.code === "P0002") && !/violates|constraint|relation|column/i.test(m)) return m;
  if (error.code === "23505") return "That already exists.";
  return GENERIC_ERROR;
}
