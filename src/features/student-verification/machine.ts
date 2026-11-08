/**
 * The request status machine. Mirrors private.can_transition() in the database (the database is
 * the authority; a test compares every pair so the two cannot drift).
 */
export const STATUSES = [
  "DRAFT",
  "AWAITING_EMAIL_VERIFICATION",
  "AWAITING_EVIDENCE",
  "SUBMITTED",
  "UNDER_REVIEW",
  "MORE_INFORMATION_REQUIRED",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
  "EXPIRED",
  "REVOKED",
] as const;
export type RequestStatus = (typeof STATUSES)[number];

export const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  DRAFT: ["AWAITING_EMAIL_VERIFICATION", "AWAITING_EVIDENCE", "WITHDRAWN"],
  AWAITING_EMAIL_VERIFICATION: ["AWAITING_EVIDENCE", "WITHDRAWN"],
  AWAITING_EVIDENCE: ["SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["UNDER_REVIEW", "WITHDRAWN"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "MORE_INFORMATION_REQUIRED", "WITHDRAWN"],
  MORE_INFORMATION_REQUIRED: ["SUBMITTED", "WITHDRAWN"],
  APPROVED: ["EXPIRED", "REVOKED"],
  REJECTED: [],
  WITHDRAWN: [],
  EXPIRED: [],
  REVOKED: [],
};

export const canTransition = (from: RequestStatus, to: RequestStatus) => TRANSITIONS[from].includes(to);

/** Requests a member can still act on (matches the unique "one open request" index). */
export const OPEN_STATUSES: readonly RequestStatus[] = [
  "DRAFT",
  "AWAITING_EMAIL_VERIFICATION",
  "AWAITING_EVIDENCE",
  "SUBMITTED",
  "UNDER_REVIEW",
  "MORE_INFORMATION_REQUIRED",
];
