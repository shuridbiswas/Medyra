// Medyra's internal shape for a provider result. It is NOT any vendor's response format.
export type ProviderKey = "inacademia" | "sheerid" | "mycreds" | "caf_saml" | "idme" | "simulated";
export type ClaimType = "CURRENT_STUDENT" | "CURRENT_PROGRAM_STUDENT";
export type VerificationEnv = "development" | "staging" | "production";
export type AttemptState =
  | "created" | "redirected" | "provider_pending" | "proof_received" | "requires_review"
  | "approved" | "rejected" | "expired" | "revoked" | "provider_error" | "cancelled";

export type NormalizedProof = {
  provider: ProviderKey;
  providerAttemptId: string;
  claimType: ClaimType;
  outcome: "positive" | "negative" | "indeterminate";
  verifiedAt: string;
  validUntil?: string;
  /** Keyed hash of a stable, non-reassignable provider subject. Only when the contract allows it. */
  providerSubjectHash?: string;
  accountLinkage: "strong" | "partial" | "unresolved";
  issuerValidated: boolean;
  /** Only when the source itself states the program. Generic student success never sets this. */
  programStated?: boolean;
  simulated: boolean;
  /** Provider was in test mode: never proof of real enrolment. */
  sandbox: boolean;
  evidenceDigest?: string;
};

export type ProviderConfig = {
  provider: ProviderKey;
  enabled: boolean;
  environment: VerificationEnv;
  contractState: "none" | "awaiting_contract" | "awaiting_credentials" | "sandbox" | "live";
  claims: ClaimType[];
};
