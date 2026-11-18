// @vitest-environment node
//
// University SSO (provisional affiliation) and document-program analysis, against the real migrations.
// Everything is fictional. The only connection used is the local mock one.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, ids, type Harness } from "./helpers";

let h: Harness;
const { alice, bob, admin } = ids;
const KEY = "s".repeat(40) + "-test-writer-key";
const CONSENT = "student-verification-2026-11-draft";
const STATE = (n: number) => String(n).padStart(64, "a");
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const dateOnly = (n: number) => day(n).slice(0, 10);

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.db.close();
});
beforeEach(async () => {
  await h.reset();
  await h.asOwner();
  await h.db.exec(`
    delete from public.institution_sso_attempts; delete from public.verified_institutional_subjects;
    delete from public.document_program_analysis; delete from public.verification_writer_keys;
    delete from public.academic_programs;
    update public.institution_sso_connections set protocol = 'oidc', approval_state = 'researched', issuer = null, client_id = null, affiliation_scopes = '{}';
    update public.institution_sso_connections set protocol = 'mock', approval_state = 'sandbox_approved', issuer = 'https://mock-idp.test.invalid',
      client_id = 'medyra-test-client', affiliation_scopes = '{mock-udem.test}'
      where institution_id = (select id from public.academic_institutions where slug = 'udem');
  `);
  await h.db.query("insert into public.verification_writer_keys (key_hash, label) values (encode(sha256(convert_to($1,'UTF8')),'hex'), 'test')", [KEY]);
});

const inst = async (slug = "udem") => (await h.asOwner(), await h.rows<{ id: string }>("select id from public.academic_institutions where slug = $1", [slug]))[0].id;
async function program(name = "Fictional nursing programme (test)", slug = "udem") {
  await h.asOwner();
  return (await h.rows<{ id: string }>(
    `insert into public.academic_programs (institution_id, category, official_name, credential_level, catalog_url, classification, source_reviewed_at)
     values ((select id from public.academic_institutions where slug = $1), 'nursing', $2, 'bachelor', 'https://example.test/c', 'direct_entry_professional', now()) returning id`,
    [slug, name]))[0].id;
}
async function request(user: string, claim = "CURRENT_STUDENT", prog: string | null = null) {
  const i = await inst();
  await h.asUser(user);
  const id = (await h.rows<{ id: string }>("select public.start_student_verification($1,$2,$3,'OFFICIAL_ATTESTATION_REVIEW') as id", [i, prog, claim]))[0].id;
  await h.db.query("select public.skip_email_step($1)", [id]);
  return id;
}
async function startSso(user: string, req: string, state = STATE(1)) {
  await h.asUser(user);
  return (await h.rows<{ id: string }>("select public.start_sso_attempt($1,$2) as id", [req, state]))[0].id;
}
const status = async (id: string) => {
  await h.asOwner();
  return (await h.rows<{ status: string }>("select status from public.institution_sso_attempts where id = $1", [id]))[0].status;
};
/** The callback's trusted writer, as the anonymous web connection. */
async function complete(attempt: string, over: Record<string, unknown> = {}, key: string | null = KEY) {
  const v = { outcome: "student", failure: null, subject: "subject-hash-0123456789", evidence: "eduPersonScopedAffiliation", until: day(14), ...over };
  await h.asUser(null);
  return (await h.rows<{ s: string }>("select public.complete_sso_attempt($1,$2,$3,$4,$5,$6,now(),$7) as s", [key, attempt, v.outcome, v.failure, v.subject, v.evidence, v.until]))[0].s;
}
const badges = async (u: string) => {
  await h.asUser(bob);
  return h.rows("select * from public.verified_badges($1::uuid[])", [[u]]);
};

describe("institution registry", () => {
  it("lists the eight Montréal candidates as researched only, with no issuer or approval", async () => {
    await h.asOwner();
    await h.db.exec("update public.institution_sso_connections set approval_state = 'researched', protocol = 'oidc', issuer = null, client_id = null, affiliation_scopes = '{}'");
    const rows = await h.rows<{ slug: string; approval_state: string }>("select i.slug, c.approval_state from public.institution_sso_connections c join public.academic_institutions i on i.id = c.institution_id order by 1");
    expect(rows.map((r) => r.slug)).toEqual(["concordia", "ets", "hec", "inrs", "mcgill", "polymtl", "udem", "uqam"]);
    expect(rows.every((r) => r.approval_state === "researched")).toBe(true);
  });
  it("cannot be approved without an issuer, client and scope; a mock connection can never be production", async () => {
    await h.asOwner();
    expect(await h.failure("update public.institution_sso_connections set approval_state = 'sandbox_approved' where institution_id = (select id from public.academic_institutions where slug = 'mcgill')")).toMatch(/isc_approved_needs_issuer/);
    expect(await h.failure("update public.institution_sso_connections set approval_state = 'production_approved' where protocol = 'mock'")).toMatch(/isc_mock_never_production/);
  });
  it("members see only whether a connection is usable, never its issuer details", async () => {
    await h.asUser(alice);
    expect((await h.rows("select institution_id, protocol, approval_state from public.institution_sso_connections")).length).toBeGreaterThan(0);
    expect(await h.failure("select issuer from public.institution_sso_connections")).toMatch(/permission denied/);
    const r = await h.db.query("update public.institution_sso_connections set approval_state = 'disabled'");
    expect(r.affectedRows).toBe(0);
  });
});

describe("starting a university login", () => {
  it("is refused for an institution without an approved connection (official document path remains)", async () => {
    const i = await inst("mcgill");
    await h.asUser(alice);
    const id = (await h.rows<{ id: string }>("select public.start_student_verification($1,null,'CURRENT_STUDENT','OFFICIAL_ATTESTATION_REVIEW') as id", [i]))[0].id;
    await h.db.query("select public.skip_email_step($1)", [id]);
    expect(await h.failure("select public.start_sso_attempt($1,$2)", [id, STATE(2)])).toMatch(/not available/);
  });
  it("one in-progress login per request, and a member cannot use someone else's request", async () => {
    const r = await request(alice);
    await startSso(alice, r);
    await h.asUser(alice);
    expect(await h.failure("select public.start_sso_attempt($1,$2)", [r, STATE(2)])).toMatch(/already in progress/);
    await h.asUser(bob);
    expect(await h.failure("select public.start_sso_attempt($1,$2)", [r, STATE(3)])).toMatch(/not found/i);
  });
  it("members cannot write attempts or read the state or subject hashes", async () => {
    const r = await request(alice);
    const a = await startSso(alice, r);
    await h.asUser(alice);
    expect(await h.failure("update public.institution_sso_attempts set status = 'provisional'")).toMatch(/permission denied/);
    expect(await h.failure("select state_hash from public.institution_sso_attempts")).toMatch(/permission denied/);
    expect(await h.failure("select subject_hash from public.institution_sso_attempts")).toMatch(/permission denied/);
    await h.asUser(bob);
    expect(await h.rows("select id from public.institution_sso_attempts")).toHaveLength(0);
    await h.asUser(alice);
    await h.db.query("select public.cancel_sso_attempt($1)", [a]);
    expect(await status(a)).toBe("cancelled");
  });
});

describe("completing a login (trusted writer)", () => {
  it("refuses a missing, wrong or short key", async () => {
    const a = await startSso(alice, await request(alice));
    for (const key of [null, "short", "x".repeat(50)]) {
      await h.asUser(null);
      expect(await h.failure("select public.complete_sso_attempt($1,$2,'student',null,'s',null,now(),null)", [key, a])).toMatch(/Not allowed/);
    }
    await h.asUser(alice);
    expect(await h.failure("select public.complete_sso_attempt($1,$2,'student',null,'s',null,now(),null)", ["x".repeat(50), a])).toMatch(/Not allowed/);
    expect(await status(a)).toBe("started");
  });
  it("a trusted student claim with a subject is provisional, private, and never a badge", async () => {
    const a = await startSso(alice, await request(alice));
    expect(await complete(a)).toBe("provisional");
    await h.asUser(alice);
    expect(await h.rows("select * from public.my_provisional_affiliations()")).toHaveLength(1);
    await h.asUser(bob);
    expect(await h.rows("select * from public.my_provisional_affiliations()")).toHaveLength(0);
    expect(await badges(alice)).toHaveLength(0);
  });
  it("a login without a student claim, or without a subject, is confirmed-only", async () => {
    const a = await startSso(alice, await request(alice));
    expect(await complete(a, { outcome: "confirmed_only", until: null })).toBe("sso_confirmed_only");
    const b = await startSso(bob, await request(bob), STATE(9));
    expect(await complete(b, { subject: null })).toBe("sso_confirmed_only");
    await h.asUser(bob);
    expect(await h.rows("select * from public.my_provisional_affiliations()")).toHaveLength(0);
  });
  it("is single use: a replay returns the recorded result and changes nothing", async () => {
    const a = await startSso(alice, await request(alice));
    expect(await complete(a)).toBe("provisional");
    expect(await complete(a, { outcome: "failed", subject: null, until: null })).toBe("provisional");
    expect(await status(a)).toBe("provisional");
  });
  it("an expired attempt cannot complete", async () => {
    const a = await startSso(alice, await request(alice));
    await h.asOwner();
    await h.db.query("update public.institution_sso_attempts set expires_at = now() - interval '1 minute' where id = $1", [a]);
    expect(await complete(a)).toBe("expired");
  });
  it("the same university identity on a second Medyra account goes to review, not provisional", async () => {
    const a = await startSso(alice, await request(alice));
    expect(await complete(a)).toBe("provisional");
    const b = await startSso(bob, await request(bob), STATE(7));
    expect(await complete(b)).toBe("review_required");
    await h.asUser(bob);
    expect(await h.rows("select * from public.my_provisional_affiliations()")).toHaveLength(0);
  });
  it("a provisional status is capped at 30 days and disappears at expiry", async () => {
    const a = await startSso(alice, await request(alice));
    await complete(a, { until: day(90) });
    await h.asOwner();
    const r = (await h.rows<{ days: number }>("select extract(day from provisional_until - now())::int as days from public.institution_sso_attempts where id = $1", [a]))[0];
    expect(r.days).toBeLessThanOrEqual(30);
    await h.db.query("update public.institution_sso_attempts set provisional_until = now() - interval '1 second' where id = $1", [a]);
    await h.asUser(alice);
    expect(await h.rows("select * from public.my_provisional_affiliations()")).toHaveLength(0);
  });
  it("a failed login records no subject", async () => {
    const a = await startSso(alice, await request(alice));
    expect(await complete(a, { outcome: "failed", failure: "token_invalid", subject: null, until: null })).toBe("failed");
    await h.asOwner();
    expect(await h.rows("select 1 from public.verified_institutional_subjects")).toHaveLength(0);
  });
});

describe("document analysis feeding the existing review", () => {
  async function analysis(evidence: string, over: Record<string, unknown> = {}, prog: string | null = null) {
    const v = { type: "current_enrollment", lang: "fr", status: "current", start: dateOnly(-30), end: dateOnly(60), name: "matched", flags: [] as string[], ...over };
    const i = await inst();
    await h.asUser(null);
    return (await h.rows<{ id: string }>(
      "select public.record_document_analysis($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'simulated-model') as id",
      [KEY, evidence, v.type, v.lang, v.status, v.start, v.end, prog, i, v.name, v.flags]))[0].id;
  }
  async function toReview(claim = "CURRENT_STUDENT", prog: string | null = null) {
    const r = await request(alice, claim, prog);
    await h.asUser(alice);
    await h.db.query("select public.add_verification_evidence($1,'official_attestation',$2,'application/pdf',1000,'abc',null)", [r, `${alice}/${r}/file.pdf`]);
    await h.db.query("select public.submit_student_verification($1,$2)", [r, CONSENT]);
    await h.asUser(admin);
    await h.db.query("select public.claim_student_verification($1)", [r]);
    await h.asOwner();
    const e = (await h.rows<{ id: string }>("select id from public.student_verification_evidence where request_id = $1", [r]))[0].id;
    return { r, e };
  }
  const identity = async (r: string) => {
    await h.asUser(admin);
    await h.db.query("select public.record_verification_checks($1,false,null,'unchecked',false,false,null,null,'not_requested','identity-ref-0123456789',null)", [r]);
  };

  it("the writer needs the key and stores no authenticity: a new analysis is NOT_CHECKED", async () => {
    const { e } = await toReview();
    await h.asUser(null);
    expect(await h.failure("select public.record_document_analysis($1,$2,'current_enrollment','fr','current',null,null,null,null,'matched','{}','m')", ["x".repeat(50), e])).toMatch(/Not allowed/);
    const id = await analysis(e);
    await h.asOwner();
    expect((await h.rows<{ authenticity: string }>("select authenticity from public.document_program_analysis where id = $1", [id]))[0].authenticity).toBe("NOT_CHECKED");
  });
  it("members cannot read analyses or set authenticity", async () => {
    const { r, e } = await toReview();
    const id = await analysis(e);
    await h.asUser(alice);
    expect(await h.rows("select id from public.document_program_analysis")).toHaveLength(0);
    expect(await h.failure("select public.set_document_authenticity($1,'REGISTRAR_CONFIRMED')", [id])).toMatch(/Not allowed/);
    expect(await h.failure("select public.apply_document_analysis_to_review($1)", [r])).toMatch(/Not allowed/);
  });
  it("AI-style text recognition alone is never enough: authenticity must be confirmed first", async () => {
    const { r, e } = await toReview();
    await analysis(e);
    await identity(r);
    await h.asUser(admin);
    expect(await h.failure("select public.apply_document_analysis_to_review($1)", [r])).toMatch(/confirmed authenticity/);
    expect(await h.failure("select public.approve_verification($1,'CURRENT_STUDENT')", [r])).toMatch(/checklist/);
  });
  it("suspected tampering and unverifiable documents are not copied", async () => {
    const { r, e } = await toReview();
    const id = await analysis(e);
    await identity(r);
    for (const s of ["SUSPECTED_TAMPERING", "UNVERIFIABLE"]) {
      await h.asUser(admin);
      await h.db.query("select public.set_document_authenticity($1,$2)", [id, s]);
      expect(await h.failure("select public.apply_document_analysis_to_review($1)", [r])).toMatch(/confirmed authenticity/);
    }
  });
  it("the file must have passed inspection first", async () => {
    const { r, e } = await toReview();
    const id = await analysis(e);
    await identity(r);
    await h.asUser(admin);
    await h.db.query("select public.set_document_authenticity($1,'ISSUER_VALIDATED')", [id]);
    expect(await h.failure("select public.apply_document_analysis_to_review($1)", [r])).toMatch(/Inspect the file/);
  });
  async function ready(over: Record<string, unknown> = {}, prog: string | null = null, claim = "CURRENT_STUDENT", requested: string | null = null) {
    const { r, e } = await toReview(claim, requested);
    const id = await analysis(e, over, prog);
    await identity(r);
    await h.asUser(admin);
    await h.db.query("select public.set_evidence_scan($1,'static_ok')", [e]);
    await h.db.query("select public.set_document_authenticity($1,'ISSUER_VALIDATED')", [id]);
    return { r, e, id };
  }
  it("a genuine current enrolment becomes a general student credential only after a reviewer approves", async () => {
    const { r } = await ready();
    expect(await badges(alice)).toHaveLength(0);
    await h.asUser(admin);
    await h.db.query("select public.apply_document_analysis_to_review($1)", [r]);
    expect(await badges(alice)).toHaveLength(0);
    await h.asUser(admin);
    await h.db.query("select public.approve_verification($1,'CURRENT_STUDENT')", [r]);
    expect(await badges(alice)).toHaveLength(1);
  });
  it("a program credential needs the exact requested catalogue program", async () => {
    const p = await program();
    const other = await program("Another fictional programme (test)");
    const wrong = await ready({}, other, "CURRENT_PROGRAM_STUDENT", p);
    await h.asUser(admin);
    expect(await h.failure("select public.apply_document_analysis_to_review($1)", [wrong.r])).toMatch(/does not confirm the requested program/);
  });
  it("the matching program yields a program credential", async () => {
    const p = await program();
    const { r } = await ready({}, p, "CURRENT_PROGRAM_STUDENT", p);
    await h.asUser(admin);
    await h.db.query("select public.apply_document_analysis_to_review($1)", [r]);
    await h.db.query("select public.approve_verification($1,'CURRENT_PROGRAM_STUDENT')", [r]);
    expect((await badges(alice))[0]).toMatchObject({ claim_type: "CURRENT_PROGRAM_STUDENT" });
  });
  it("past terms, admissions, name mismatches and other institutions are never copied", async () => {
    for (const [over, pattern] of [
      [{ end: dateOnly(-1) }, /current academic term/],
      [{ type: "admission" }, /not a current enrolment/],
      [{ status: "past" }, /not a current enrolment/],
      [{ name: "mismatch" }, /not matched/],
      [{ name: "ambiguous" }, /not matched/],
    ] as const) {
      await h.reset();
      await h.asOwner();
      await h.db.exec("delete from public.document_program_analysis");
      const { r } = await ready(over as Record<string, unknown>);
      await h.asUser(admin);
      expect(await h.failure("select public.apply_document_analysis_to_review($1)", [r])).toMatch(pattern);
    }
  });
  it("a mock SSO subject is never used as the identity reference", async () => {
    const r = await request(alice);
    const a = await startSso(alice, r);
    await complete(a); // provisional via the mock connection
    await h.asUser(alice);
    await h.db.query("select public.add_verification_evidence($1,'official_attestation',$2,'application/pdf',1000,'abc',null)", [r, `${alice}/${r}/file.pdf`]);
    await h.db.query("select public.submit_student_verification($1,$2)", [r, CONSENT]);
    await h.asUser(admin);
    await h.db.query("select public.claim_student_verification($1)", [r]);
    await h.asOwner();
    const e = (await h.rows<{ id: string }>("select id from public.student_verification_evidence where request_id = $1", [r]))[0].id;
    const i = await inst();
    await h.asUser(null);
    const id = (await h.rows<{ id: string }>("select public.record_document_analysis($1,$2,'current_enrollment','en','current',$3,$4,null,$5,'matched','{}','m') as id", [KEY, e, dateOnly(-5), dateOnly(60), i]))[0].id;
    await h.asUser(admin);
    await h.db.query("select public.set_evidence_scan($1,'static_ok')", [e]);
    await h.db.query("select public.set_document_authenticity($1,'REGISTRAR_CONFIRMED')", [id]);
    expect(await h.failure("select public.apply_document_analysis_to_review($1)", [r])).toMatch(/identity reference/);
  });
  it("a reviewer cannot apply a document to their own request", async () => {
    const r = await request(admin);
    await h.asUser(admin);
    await h.db.query("select public.add_verification_evidence($1,'official_attestation',$2,'application/pdf',1000,'abc',null)", [r, `${admin}/${r}/file.pdf`]);
    await h.db.query("select public.submit_student_verification($1,$2)", [r, CONSENT]);
    expect(await h.failure("select public.claim_student_verification($1)", [r])).toMatch(/your own/);
  });
});
