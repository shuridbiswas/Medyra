// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFormData } from "@/test/mocks";

const REQ = "33333333-3333-4333-8333-333333333333";
const INST = "44444444-4444-4444-8444-444444444444";
const ME = "11111111-1111-4111-8111-111111111111";

const order: string[] = [];
const rpc = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
const sendToAddress = vi.fn(async () => ({ status: "sent", id: "e" }));
let selectData: unknown = { institution_id: INST };
let limit: { ok: true } | { ok: false; message: string } = { ok: true };

class Redirect extends Error {
  constructor(public url: string) {
    super(url);
  }
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => limit }));
vi.mock("@/lib/monitoring/report", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendToAddress, sendToMember: vi.fn(async () => ({ status: "skipped" })) }));
vi.mock("@/lib/auth/session", () => ({
  requireMember: async () => {
    order.push("requireMember");
    return { user: { id: ME, user_metadata: { first_name: "Alex" } }, profile: { id: ME } };
  },
  requireAdmin: async () => {
    order.push("requireAdmin");
    return { user: { id: ME }, profile: { id: ME } };
  },
}));
vi.mock("@/features/student-verification/queries", () => ({
  getInstitution: async () => ({ institution: { id: INST, name: "Fictional University", email_domains: ["school.test"] }, methods: [], programs: [] }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    from: () => {
      const chain = { select: () => chain, eq: () => chain, is: () => chain, maybeSingle: async () => ({ data: selectData }) };
      return chain;
    },
    storage: { from: () => ({ upload, remove, download: vi.fn(), createSignedUrl: vi.fn() }) },
  }),
}));

process.env.VERIFICATION_SECRET = "test-secret-test-secret-test-secret";

const member = await import("@/features/student-verification/actions");
const admin = await import("@/features/student-verification/admin-actions");
const { inspectEvidence, cleanReference } = await import("@/features/student-verification/evidence");
const { credentialTitle } = await import("@/features/student-verification/content");
const { friendlyDbError } = await import("@/features/student-verification/errors");
const crypto = await import("@/features/student-verification/crypto");

async function redirectOf(fn: () => Promise<void>): Promise<URL> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof Redirect) return new URL(e.url, "http://x");
    throw e;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  limit = { ok: true };
  selectData = { institution_id: INST };
  rpc.mockResolvedValue({ data: null, error: null });
  upload.mockResolvedValue({ error: null });
});

const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.4\n1 0 obj <<${extra}>> endobj\ntrailer\n%%EOF\n`);

describe("evidence inspection", () => {
  it("accepts a plain PDF, PNG and JPEG by their real bytes", () => {
    expect(inspectEvidence(pdf(), "application/pdf")).toMatchObject({ ok: true, ext: "pdf" });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
    expect(inspectEvidence(png, "image/png")).toMatchObject({ ok: true, ext: "png" });
    expect(inspectEvidence(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]), "image/jpeg")).toMatchObject({ ok: true, ext: "jpg" });
  });

  it("refuses scripts, embedded files, encryption, launch actions, zips, disguised files, empty and oversized files", () => {
    for (const bad of ["/JavaScript (x)", "/JS (x)", "/EmbeddedFile", "/Encrypt 5 0 R", "/Launch", "/OpenAction 3 0 R"]) {
      expect(inspectEvidence(pdf(bad)).ok, bad).toBe(false);
    }
    expect(inspectEvidence(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])).ok).toBe(false); // zip
    expect(inspectEvidence(new TextEncoder().encode("MZ executable")).ok).toBe(false);
    expect(inspectEvidence(pdf(), "image/png")).toEqual({ ok: false, reason: "The file type does not match its contents." });
    expect(inspectEvidence(new Uint8Array(0)).ok).toBe(false);
    expect(inspectEvidence(new Uint8Array(5 * 1024 * 1024 + 1)).ok).toBe(false);
    expect(inspectEvidence(new TextEncoder().encode("%PDF-1.4 no end")).ok).toBe(false); // truncated
    expect(inspectEvidence(pdf("/JSON ok")).ok).toBe(true); // "/JS" does not match "/JSON"
  });

  it("stores a pasted reference as text and never accepts non-https schemes", () => {
    expect(cleanReference(" ABC-1234 ")).toEqual({ ok: true, value: "ABC-1234" });
    expect(cleanReference("https://share.example.test/x?id=1")).toMatchObject({ ok: true });
    for (const bad of ["ab", "javascript:alert(1)", "file:///etc/passwd", "http://insecure.test", "x".repeat(501), "a\u0000bcd"]) {
      expect(cleanReference(bad).ok, bad).toBe(false);
    }
  });
});

describe("wording and errors", () => {
  const base = { institution_name: "Université de Montréal", institution_name_en: "University of Montreal", institution_name_fr: "Université de Montréal", verification_method: "OFFICIAL_ATTESTATION_REVIEW", verified_at: "2026-11-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z" };
  it("names exactly what was verified and nothing more", () => {
    expect(credentialTitle({ ...base, claim_type: "CURRENT_STUDENT", program_name: null, category: null, category_label_en: null, category_label_fr: null }, "en")).toBe("Student");
    expect(credentialTitle({ ...base, claim_type: "CURRENT_PROGRAM_STUDENT", program_name: "X", category: "nursing", category_label_en: "Nursing", category_label_fr: "Sciences infirmières" }, "en")).toBe("Nursing Student");
    expect(credentialTitle({ ...base, claim_type: "CURRENT_PROGRAM_STUDENT", program_name: "X", category: "social_work", category_label_en: "Social Work", category_label_fr: "Travail social" }, "en")).toBe("Social Work Student");
    expect(credentialTitle({ ...base, claim_type: "CURRENT_STUDENT", program_name: null, category: null, category_label_en: null, category_label_fr: null }, "fr")).toBe("Étudiant");
  });

  it("shows our database sentences but hides internals", () => {
    expect(friendlyDbError({ code: "23514", message: "You already have an open request for this." })).toBe("You already have an open request for this.");
    expect(friendlyDbError({ code: "23514", message: 'new row violates check constraint "x"' })).toBe("Something went wrong. Please try again.");
    expect(friendlyDbError({ code: "42501", message: "Not allowed" })).toBe("You are not allowed to do that.");
    expect(friendlyDbError(null)).toBe("Something went wrong. Please try again.");
  });

  it("hashes with a key: codes and addresses are not recoverable and differ per purpose", () => {
    expect(crypto.emailCodeHash(ME, REQ, "123456")).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.emailCodeHash(ME, REQ, "123456")).not.toBe(crypto.emailCodeHash(ME, REQ, "123457"));
    expect(crypto.emailAddressHash(INST, "A@School.test ")).toBe(crypto.emailAddressHash(INST, "a@school.test"));
    expect(crypto.bindingHash(INST, "123 456")).toBe(crypto.bindingHash(INST, "123456"));
    expect(crypto.generateEmailCode()).toMatch(/^\d{6}$/);
  });
});

describe("member actions", () => {
  it("starts a request for the institution picked, with a program implying the program claim, never an owner from the form", async () => {
    rpc.mockResolvedValueOnce({ data: REQ, error: null });
    const url = await redirectOf(() =>
      member.startVerification(makeFormData({ institutionId: INST, programId: "", method: "OFFICIAL_ATTESTATION_REVIEW", userId: "evil" })),
    );
    expect(order[0]).toBe("requireMember");
    expect(rpc).toHaveBeenCalledWith("start_student_verification", { p_institution: INST, p_program: null, p_claim: "CURRENT_STUDENT", p_method: "OFFICIAL_ATTESTATION_REVIEW" });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("evil");
    expect(url.pathname).toBe("/verification/student");
    expect(url.searchParams.get("request")).toBe(REQ);
  });

  it("rejects unknown methods and bad ids before asking the database, and shows rate limits", async () => {
    const bad = await redirectOf(() => member.startVerification(makeFormData({ institutionId: "nope", method: "INSTITUTIONAL_EMAIL" })));
    expect(bad.searchParams.get("error")).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
    limit = { ok: false, message: "Slow down." };
    expect((await redirectOf(() => member.startVerification(makeFormData({ institutionId: INST, method: "OFFICIAL_ATTESTATION_REVIEW" })))).searchParams.get("error")).toBe("Slow down.");
  });

  it("sends the school-email code to the typed address only through the database-checked path and stores hashes, not the address", async () => {
    const url = await redirectOf(() => member.sendInstitutionalCode(makeFormData({ requestId: REQ, email: "Alex@School.test" })));
    const args = rpc.mock.calls[0][1] as Record<string, string>;
    expect(rpc.mock.calls[0][0]).toBe("create_email_challenge");
    expect(args.p_domain).toBe("school.test");
    expect(JSON.stringify(args)).not.toContain("alex@");
    expect(args.p_email_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sendToAddress).toHaveBeenCalledTimes(1);
    expect((sendToAddress.mock.calls[0] as unknown as [string, unknown, string])[0]).toBe("alex@school.test");
    expect(url.searchParams.get("notice")).toMatch(/Code sent/);
  });

  it("does not email anything when the database refuses the domain", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23514", message: "That email address does not belong to a confirmed school domain." } });
    const url = await redirectOf(() => member.sendInstitutionalCode(makeFormData({ requestId: REQ, email: "x@gmail.com" })));
    expect(sendToAddress).not.toHaveBeenCalled();
    expect(url.searchParams.get("error")).toMatch(/confirmed school domain/);
  });

  it("sends the code's keyed hash for checking, and explains every failure word", async () => {
    for (const [word, text] of [["wrong", /didn't match/], ["expired", /expired/], ["locked", /Too many/], ["in_use", /already confirmed/]] as const) {
      rpc.mockResolvedValueOnce({ data: word, error: null });
      const url = await redirectOf(() => member.confirmInstitutionalCode(makeFormData({ requestId: REQ, code: "123456" })));
      expect(url.searchParams.get("error")).toMatch(text);
    }
    expect((rpc.mock.calls[0][1] as Record<string, string>).p_code_hash).toBe(crypto.emailCodeHash(ME, REQ, "123456"));
    rpc.mockResolvedValueOnce({ data: "ok", error: null });
    expect((await redirectOf(() => member.confirmInstitutionalCode(makeFormData({ requestId: REQ, code: "123456" })))).searchParams.get("notice")).toMatch(/does not verify your enrolment/);
    expect((await redirectOf(() => member.confirmInstitutionalCode(makeFormData({ requestId: REQ, code: "12" })))).searchParams.get("error")).toMatch(/6 digits/);
  });

  it("refuses an unsafe or disguised upload without storing it", async () => {
    const evil = new File([pdf("/JavaScript (x)")], "a.pdf", { type: "application/pdf" });
    const url = await redirectOf(() => member.uploadEvidence(makeFormData({ requestId: REQ, file: evil as never })));
    expect(url.searchParams.get("error")).toMatch(/scripts/);
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stores a good upload under a random path in the member's own folder, then registers it; removes it if registering fails", async () => {
    const good = new File([pdf()], "attestation.pdf", { type: "application/pdf" });
    await redirectOf(() => member.uploadEvidence(makeFormData({ requestId: REQ, file: good as never })));
    const path = upload.mock.calls[0][0] as string;
    expect(path).toMatch(new RegExp(`^${ME}/${REQ}/[0-9a-f-]{36}\\.pdf$`));
    expect(path).not.toContain("attestation");
    expect(rpc).toHaveBeenCalledWith("add_verification_evidence", expect.objectContaining({ p_path: path, p_mime: "application/pdf" }));

    rpc.mockResolvedValueOnce({ data: null, error: { code: "23514", message: "You can attach up to 5 items to a request." } });
    await redirectOf(() => member.uploadEvidence(makeFormData({ requestId: REQ, file: good as never })));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("requires the consent box and the current consent version for submitting", async () => {
    expect((await redirectOf(() => member.submitVerification(makeFormData({ requestId: REQ, consentVersion: "v1" })))).searchParams.get("error")).toMatch(/consent/i);
    expect(rpc).not.toHaveBeenCalled();
    await redirectOf(() => member.submitVerification(makeFormData({ requestId: REQ, consentVersion: "v1", consent: "on" })));
    expect(rpc).toHaveBeenCalledWith("submit_student_verification", { p_request: REQ, p_consent_version: "v1" });
  });
});

describe("reviewer actions", () => {
  const forms: [string, () => Promise<void>, FormData][] = [
    ["claim", () => admin.claimVerification(makeFormData({ requestId: REQ })), makeFormData({})],
    ["approve", () => admin.approveVerification(makeFormData({ requestId: REQ, claim: "CURRENT_STUDENT" })), makeFormData({})],
    ["reject", () => admin.rejectVerification(makeFormData({ requestId: REQ, reason: "other" })), makeFormData({})],
    ["more info", () => admin.requestMoreInformation(makeFormData({ requestId: REQ, message: "x" })), makeFormData({})],
    ["revoke", () => admin.revokeCredential(makeFormData({ requestId: REQ, credentialId: INST, reason: "other" })), makeFormData({})],
    ["expiry run", () => admin.runExpiry(), makeFormData({})],
    ["purge", () => admin.purgeDueEvidence(), makeFormData({})],
  ];

  it.each(forms)("%s starts by requiring an administrator", async (_name, run) => {
    await redirectOf(run);
    expect(order[0]).toBe("requireAdmin");
    expect(order).not.toContain("requireMember");
  });

  it("approval sends only the request, the claim and an optional date; the status and credential come from the database", async () => {
    await redirectOf(() => admin.approveVerification(makeFormData({ requestId: REQ, claim: "CURRENT_STUDENT", status: "APPROVED", userId: "evil", expiresOn: "2027-01-31" })));
    expect(rpc).toHaveBeenCalledWith("approve_verification", { p_request: REQ, p_claim: "CURRENT_STUDENT", p_expires_at: "2027-01-31T23:59:59Z" });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/evil|APPROVED"/);
    rpc.mockClear();
    await redirectOf(() => admin.approveVerification(makeFormData({ requestId: REQ, claim: "SUPER_VERIFIED" })));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the database's refusal when the checklist is incomplete", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23514", message: "Complete the checklist first." } });
    const url = await redirectOf(() => admin.approveVerification(makeFormData({ requestId: REQ, claim: "CURRENT_STUDENT" })));
    expect(url.searchParams.get("error")).toBe("Complete the checklist first.");
    expect(sendToAddress).not.toHaveBeenCalled();
  });

  it("hashes the identity reference on the server and never sends it to the database in clear", async () => {
    await redirectOf(() =>
      admin.saveChecks(
        makeFormData({ requestId: REQ, identityLinkage: "matched", registrarResult: "not_requested", issuerVerified: "on", enrolmentConfirmed: "on", termStart: "2026-09-01", termEnd: "2027-04-30", identifier: "20123456", notes: "ok" }),
      ),
    );
    const call = rpc.mock.calls.find((c) => c[0] === "record_verification_checks");
    expect(call).toBeTruthy();
    const args = call![1] as Record<string, unknown>;
    expect(JSON.stringify(args)).not.toContain("20123456");
    expect(args.p_binding_hash).toBe(crypto.bindingHash(INST, "20123456"));
    expect(args).toMatchObject({ p_issuer_verified: true, p_identity_linkage: "matched", p_enrolment_confirmed: true, p_program_confirmed: false });
  });

  it("tells the member by email after a decision, with a pointer to the dashboard and no notes", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "verification_notice_recipient" ? { data: [{ user_id: ME, email: "student@example.test", first_name: "Sam" }], error: null } : { data: null, error: null },
    );
    await redirectOf(() => admin.rejectVerification(makeFormData({ requestId: REQ, reason: "not_current", message: "private-ish" })));
    expect(sendToAddress).toHaveBeenCalledTimes(1);
    const [to, message] = sendToAddress.mock.calls[0] as unknown as [string, { subject: string; text: string; html: string }];
    expect(to).toBe("student@example.test");
    expect(message.text).toContain("/verification/student/status");
    expect(message.html + message.text).not.toContain("private-ish");
  });
});
