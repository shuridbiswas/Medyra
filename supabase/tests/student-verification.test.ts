// @vitest-environment node
//
// Quebec student verification: policies, the status machine, issuance, expiry and revocation,
// run against the real migrations in PGlite. Every person here is fictional.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, ids, type Harness } from "./helpers";
import { STATUSES, canTransition } from "../../src/features/student-verification/machine";

let h: Harness;
const { alice, bob, carol, admin } = ids;
const CONSENT = "student-verification-2026-11-draft";
const ZED = "00000000-0000-0000-0000-0000000000ee";

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
  await h.asOwner();
  await h.db.exec(`delete from storage.objects; delete from public.staff_roles where user_id <> '${admin}'`);
});
afterAll(async () => {
  await h.db.close();
});

const inst = async (slug = "udem") =>
  (await h.rows<{ id: string }>("select id from public.academic_institutions where slug = $1", [slug]))[0].id;

async function program(slug = "udem", category = "nursing", name = "Fictional nursing programme (test)") {
  await h.asOwner();
  const r = await h.rows<{ id: string }>(
    `insert into public.academic_programs (institution_id, category, official_name, credential_level, catalog_url, classification, source_reviewed_at)
     values ((select id from public.academic_institutions where slug = $1), $2, $3, 'bachelor', 'https://example.test/catalog', 'direct_entry_professional', now())
     returning id`,
    [slug, category, name],
  );
  return r[0].id;
}

async function start(user: string, claim = "CURRENT_STUDENT", prog: string | null = null, slug = "udem", method = "OFFICIAL_ATTESTATION_REVIEW") {
  const institution = await inst(slug);
  await h.asUser(user);
  const r = await h.rows<{ id: string }>("select public.start_student_verification($1, $2, $3, $4) as id", [institution, prog, claim, method]);
  return r[0].id;
}

const status = async (id: string) => {
  await h.asOwner();
  return (await h.rows<{ status: string }>("select status from public.student_verification_requests where id = $1", [id]))[0].status;
};

/** A request that is ready for a reviewer (evidence added and consent given). */
async function submitted(user: string, claim = "CURRENT_STUDENT", prog: string | null = null, slug = "udem") {
  const id = await start(user, claim, prog, slug);
  await h.db.query("select public.skip_email_step($1)", [id]);
  await h.db.query("select public.add_verification_evidence($1, 'official_attestation', $2, 'application/pdf', 1000, 'abc', null)", [id, `${user}/${id}/file.pdf`]);
  await h.db.query("select public.submit_student_verification($1, $2)", [id, CONSENT]);
  return id;
}

async function evidenceId(request: string) {
  await h.asOwner();
  return (await h.rows<{ id: string }>("select id from public.student_verification_evidence where request_id = $1", [request]))[0].id;
}

type Over = Partial<Record<"issuer" | "link" | "enrol" | "prog" | "start" | "end" | "registrar" | "binding", unknown>>;
const checks = (request: string, over: Over = {}) => {
  const v = { issuer: true, link: "matched", enrol: true, prog: false, start: inDays(-60), end: inDays(120), registrar: "not_requested", binding: "binding-hash-0123456789", ...over };
  return h.db.query("select public.record_verification_checks($1,$2,'Fictional Registrar',$3,$4,$5,$6,$7,$8,$9,'test note')", [request, v.issuer, v.link, v.enrol, v.prog, v.start, v.end, v.registrar, v.binding]);
};

/** The reviewer takes a submitted request through inspection and the checklist, ready to approve. */
async function review(request: string, over: Over = {}) {
  await h.asUser(admin);
  await h.db.query("select public.claim_student_verification($1)", [request]);
  const e = await evidenceId(request);
  await h.asUser(admin);
  await h.db.query("select public.set_evidence_scan($1, 'static_ok')", [e]);
  await h.db.query("select public.review_evidence($1, 'validated')", [e]);
  await checks(request, over);
}

const approve = (request: string, claim = "CURRENT_STUDENT") => h.db.query("select public.approve_verification($1, $2, null)", [request, claim]);
async function badges(viewer: string, users: string[]) {
  await h.asUser(viewer);
  return h.rows<{ user_id: string; claim_type: string; program_name: string | null; institution_name: string }>("select * from public.verified_badges($1::uuid[])", [users]);
}
const verifyCode = async (id: string, hash: string) =>
  (await h.rows<{ v: string }>("select public.verify_email_challenge($1, $2) as v", [id, hash]))[0].v;

describe("registry", () => {
  it("seeds the 23 Quebec institutions with unconfirmed domains and no invented programs", async () => {
    await h.asUser(alice);
    expect(await h.rows("select 1 from public.academic_institutions")).toHaveLength(23);
    expect(await h.rows("select 1 from public.academic_institutions where email_domains <> '{}'")).toHaveLength(0);
    expect(await h.rows("select 1 from public.academic_programs")).toHaveLength(0);
    expect(await h.rows("select 1 from public.program_categories")).toHaveLength(16);
    const laval = await h.rows<{ registrar_url: string }>("select registrar_url from public.academic_institutions where slug = 'laval'");
    expect(laval[0].registrar_url).toBe("https://monportail.ulaval.ca/validation");
  });

  it("refuses a domain list without a confirmed status, and lets only staff edit", async () => {
    await h.asOwner();
    expect(await h.failure("update public.academic_institutions set email_domains = array['x.test'] where slug = 'udem'")).toMatch(/institutions_domains_need_confirmation/);
    await h.asUser(alice);
    await h.db.query("update public.academic_institutions set active = false where slug = 'udem'"); // RLS: zero rows
    expect(await h.rows("select 1 from public.academic_institutions where active = false")).toHaveLength(0);
    await h.asUser(admin);
    await h.db.query("update public.academic_institutions set email_domains = array['school.test'], email_domains_status = 'confirmed' where slug = 'dawson'");
    expect(await h.rows("select 1 from public.academic_institutions where email_domains <> '{}'")).toHaveLength(1);
  });

  it("hides programs nobody has reviewed", async () => {
    await h.asOwner();
    await h.db.exec(`insert into public.academic_programs (institution_id, category, official_name, credential_level, classification)
      select id, 'nursing', 'Unreviewed', 'bachelor', 'direct_entry_professional' from public.academic_institutions where slug = 'udem'`);
    await h.asUser(alice);
    expect(await h.rows("select 1 from public.academic_programs")).toHaveLength(0);
  });
});

describe("starting a request", () => {
  it("requires a reviewed program of that institution for a program credential", async () => {
    const udemNursing = await program();
    const udem = await inst();
    const mcgill = await inst("mcgill");
    await h.asUser(alice);
    expect(await h.failure("select public.start_student_verification($1, null, 'CURRENT_PROGRAM_STUDENT', 'OFFICIAL_ATTESTATION_REVIEW')", [udem])).toMatch(/Choose a program/);
    expect(await h.failure("select public.start_student_verification($1, $2, 'CURRENT_PROGRAM_STUDENT', 'OFFICIAL_ATTESTATION_REVIEW')", [mcgill, udemNursing])).toMatch(/Choose a program/);
    expect(await h.failure("select public.start_student_verification($1, $2, 'CURRENT_STUDENT', 'OFFICIAL_ATTESTATION_REVIEW')", [udem, udemNursing])).toMatch(/only be requested with a program/);
    const id = await start(alice, "CURRENT_PROGRAM_STUDENT", udemNursing);
    expect(await status(id)).toBe("DRAFT");
  });

  it("refuses email-only, federated and unknown methods, and a second identical open request", async () => {
    const udem = await inst();
    await h.asUser(alice);
    for (const m of ["INSTITUTIONAL_EMAIL", "FEDERATED_INSTITUTION_LOGIN", "TELEPATHY"]) {
      expect(await h.failure("select public.start_student_verification($1, null, 'CURRENT_STUDENT', $2)", [udem, m])).toMatch(/not available/i);
    }
    await start(alice);
    expect(await h.failure("select public.start_student_verification($1, null, 'CURRENT_STUDENT', 'OFFICIAL_ATTESTATION_REVIEW')", [udem])).toMatch(/already have an open request/);
  });

  it("does not let a member who has not finished onboarding start one", async () => {
    const udem = await inst();
    await h.asUser(ids.dave);
    expect(await h.failure("select public.start_student_verification($1, null, 'CURRENT_STUDENT', 'OFFICIAL_ATTESTATION_REVIEW')", [udem])).toMatch(/Not allowed/);
  });
});

describe("what members can and cannot touch", () => {
  it("gives no direct write access to requests, evidence, credentials, the reviewer store or the audit log", async () => {
    const id = await submitted(alice);
    await h.asUser(alice);
    for (const sql of [
      "insert into public.student_verification_requests (user_id, institution_id, requested_claim_type, method) select auth.uid(), id, 'CURRENT_STUDENT', 'OFFICIAL_ATTESTATION_REVIEW' from public.academic_institutions limit 1",
      `update public.student_verification_requests set status = 'APPROVED' where id = '${id}'`,
      `delete from public.student_verification_requests where id = '${id}'`,
      "insert into public.student_verified_credentials (user_id, institution_id, claim_type, issuer, verification_method, expires_at) select auth.uid(), id, 'CURRENT_STUDENT', 'me', 'OFFICIAL_ATTESTATION_REVIEW', now() + interval '1 day' from public.academic_institutions limit 1",
      "update public.student_verified_credentials set expires_at = now() + interval '99 days'",
      "update public.student_verification_evidence set validation_status = 'validated'",
      "insert into public.verification_review_details (request_id) values (gen_random_uuid())",
      "insert into public.verification_audit_log (action, target_type) values ('x', 'y')",
      "select binding_hash from public.student_verified_credentials",
    ]) {
      expect(await h.failure(sql), sql).toMatch(/permission denied/i);
    }
  });

  it("keeps requests, evidence, events and credentials private to their owner and staff", async () => {
    const id = await submitted(alice);
    await h.asUser(bob);
    for (const t of ["student_verification_requests", "student_verification_evidence", "verification_review_events", "student_verified_credentials", "verification_review_details", "verification_audit_log"]) {
      expect(await h.rows(`select 1 from public.${t}`), t).toHaveLength(0);
    }
    await h.asUser(alice);
    expect((await h.rows("select 1 from public.student_verification_requests where id = $1", [id])).length).toBe(1);
    expect((await h.rows("select 1 from public.verification_review_events where request_id = $1", [id])).length).toBeGreaterThan(0);
    expect(await h.rows("select 1 from public.verification_review_details")).toHaveLength(0);
  });

  it("cannot attach evidence to someone else's request or with someone else's path", async () => {
    const id = await start(alice);
    await h.db.query("select public.skip_email_step($1)", [id]);
    await h.asUser(bob);
    expect(await h.failure("select public.add_verification_evidence($1, 'official_attestation', 'x/y/z.pdf', 'application/pdf', 10, 'a', null)", [id])).toMatch(/not found/i);
    await h.asUser(alice);
    expect(await h.failure("select public.add_verification_evidence($1, 'official_attestation', $2, 'application/pdf', 10, 'a', null)", [id, `${bob}/${id}/f.pdf`])).toMatch(/Not allowed/);
  });

  it("cannot withdraw or submit another member's request", async () => {
    const id = await start(alice);
    await h.asUser(bob);
    expect(await h.failure("select public.withdraw_student_verification($1)", [id])).toMatch(/not found/i);
    expect(await h.failure("select public.submit_student_verification($1, $2)", [id, CONSENT])).toMatch(/not found/i);
  });
});

describe("school email step", () => {
  async function withDomain() {
    await h.asOwner();
    await h.db.exec("update public.academic_institutions set email_domains = array['school.test'], email_domains_status = 'confirmed' where slug = 'udem'");
  }

  it("is refused while the institution's domains are unconfirmed or the domain is wrong", async () => {
    const id = await start(alice);
    expect(await h.failure("select public.create_email_challenge($1, 'school.test', 'eh', 'ch')", [id])).toMatch(/confirmed school domain/);
    await withDomain();
    await h.asUser(alice);
    expect(await h.failure("select public.create_email_challenge($1, 'gmail.com', 'eh', 'ch')", [id])).toMatch(/confirmed school domain/);
  });

  it("TEST 2: confirms with the right code once, counts wrong guesses and locks, and never awards a badge", async () => {
    await withDomain();
    const id = await start(alice);
    await h.db.query("select public.create_email_challenge($1, 'school.test', 'email-hash-1', 'code-hash-1')", [id]);
    expect(await status(id)).toBe("AWAITING_EMAIL_VERIFICATION");
    await h.asUser(alice);
    expect(await h.failure("select public.create_email_challenge($1, 'school.test', 'email-hash-1', 'code-hash-2')", [id])).toMatch(/wait a minute/);
    expect(await verifyCode(id, "nope")).toBe("wrong");
    expect(await verifyCode(id, "code-hash-1")).toBe("ok");
    expect(await status(id)).toBe("AWAITING_EVIDENCE");
    await h.asUser(alice);
    expect(await verifyCode(id, "code-hash-1")).toBe("invalid"); // a replayed code fails
    expect(await badges(bob, [alice])).toHaveLength(0); // email alone is not a badge

    await h.asOwner();
    await h.db.exec("delete from public.institutional_email_challenges");
    const id2 = await start(bob);
    await h.db.query("select public.create_email_challenge($1, 'school.test', 'email-hash-2', 'good')", [id2]);
    for (let i = 0; i < 5; i++) expect(await verifyCode(id2, "bad")).toBe("wrong");
    expect(await verifyCode(id2, "good")).toBe("locked");
  });

  it("rejects an expired code, and one school address cannot confirm two accounts", async () => {
    await withDomain();
    const a = await start(alice);
    await h.db.query("select public.create_email_challenge($1, 'school.test', 'same-address', 'c1')", [a]);
    await h.asOwner();
    await h.db.exec("update public.institutional_email_challenges set expires_at = now() - interval '1 minute'");
    await h.asUser(alice);
    expect(await verifyCode(a, "c1")).toBe("expired");
    await h.asOwner();
    await h.db.exec("delete from public.institutional_email_challenges");
    await h.asUser(alice);
    await h.db.query("select public.create_email_challenge($1, 'school.test', 'same-address', 'c2')", [a]);
    expect(await verifyCode(a, "c2")).toBe("ok");
    const b = await start(bob);
    await h.db.query("select public.create_email_challenge($1, 'school.test', 'same-address', 'c3')", [b]);
    expect(await verifyCode(b, "c3")).toBe("in_use");
  });
});

describe("status machine", () => {
  it("matches the TypeScript table for every pair of states", async () => {
    await h.asOwner();
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const r = await h.rows<{ ok: boolean }>("select private.can_transition($1, $2) as ok", [from, to]);
        expect(r[0].ok, `${from} -> ${to}`).toBe(canTransition(from, to));
      }
    }
  });

  it("refuses an invalid move even from the table owner", async () => {
    const id = await start(alice);
    await h.asOwner();
    expect(await h.failure("update public.student_verification_requests set status = 'APPROVED' where id = $1", [id])).toMatch(/not allowed from the current status/);
    expect(await h.failure("update public.student_verification_requests set user_id = $2 where id = $1", [id, bob])).toMatch(/cannot be re-assigned/);
  });

  it("cannot submit without evidence, or without accepting the current consent text", async () => {
    const id = await start(alice);
    await h.db.query("select public.skip_email_step($1)", [id]);
    expect(await h.failure("select public.submit_student_verification($1, $2)", [id, CONSENT])).toMatch(/Add your official evidence/);
    await h.db.query("select public.add_verification_evidence($1, 'issuer_share_reference', null, null, null, null, 'share-123456')", [id]);
    expect(await h.failure("select public.submit_student_verification($1, 'old-text')", [id])).toMatch(/current consent/);
    await h.db.query("select public.submit_student_verification($1, $2)", [id, CONSENT]);
    expect(await status(id)).toBe("SUBMITTED");
  });

  it("lets a registrar-confirmation request go forward with consent alone", async () => {
    const id = await start(alice, "CURRENT_STUDENT", null, "uqam", "REGISTRAR_CONFIRMATION");
    await h.db.query("select public.skip_email_step($1)", [id]);
    await h.db.query("select public.submit_student_verification($1, $2)", [id, CONSENT]);
    expect(await status(id)).toBe("SUBMITTED");
  });
});

describe("review and issuance", () => {
  it("TESTS 3-6: evidence reaches the queue, a reviewer approves, the member shows as a verified student", async () => {
    const id = await submitted(alice);
    expect(await status(id)).toBe("SUBMITTED");
    await h.asUser(admin);
    expect((await h.rows("select 1 from public.student_verification_requests where status = 'SUBMITTED'")).length).toBe(1);
    await review(id);
    await approve(id);
    expect(await status(id)).toBe("APPROVED");
    const b = await badges(bob, [alice, bob]);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ user_id: alice, claim_type: "CURRENT_STUDENT", program_name: null, institution_name: "Université de Montréal" });
    await h.asUser(alice);
    expect(await h.rows("select 1 from public.notifications where type = 'verification_update'")).toHaveLength(1);
    await h.asUser(admin);
    const actions = (await h.rows<{ action: string }>("select action from public.verification_audit_log")).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["verification.claim", "verification.checks", "verification.approve"]));
  });

  it("TEST 1: a member who has not been approved shows no badge, and signed-out visitors cannot ask", async () => {
    await submitted(alice);
    expect(await badges(bob, [alice])).toHaveLength(0);
    await h.asUser(null);
    expect(await h.failure("select * from public.verified_badges(array[gen_random_uuid()])")).toMatch(/permission denied/i);
  });

  it("TESTS 7-8: grants a program credential only when program evidence is confirmed", async () => {
    const prog = await program();
    const id = await submitted(alice, "CURRENT_PROGRAM_STUDENT", prog);
    await review(id, { prog: false });
    await h.asUser(admin);
    expect(await h.failure("select public.approve_verification($1, 'CURRENT_PROGRAM_STUDENT', null)", [id])).toMatch(/Program evidence has not been confirmed/);
    await checks(id, { prog: true });
    await approve(id, "CURRENT_PROGRAM_STUDENT");
    expect((await badges(bob, [alice]))[0]).toMatchObject({ claim_type: "CURRENT_PROGRAM_STUDENT", program_name: "Fictional nursing programme (test)" });
  });

  it("grants only the student credential when a program was requested but not confirmed", async () => {
    const prog = await program();
    const id = await submitted(alice, "CURRENT_PROGRAM_STUDENT", prog);
    await review(id, { prog: false });
    await h.asUser(admin);
    await approve(id, "CURRENT_STUDENT");
    expect((await badges(bob, [alice]))[0]).toMatchObject({ claim_type: "CURRENT_STUDENT", program_name: null });
  });

  it("cannot grant a program credential that was never requested", async () => {
    const id = await submitted(alice);
    await review(id, { prog: true });
    await h.asUser(admin);
    expect(await h.failure("select public.approve_verification($1, 'CURRENT_PROGRAM_STUDENT', null)", [id])).toMatch(/did not request a program/);
  });

  it("requires the full checklist, a validated item and an inspected file", async () => {
    const id = await submitted(alice);
    await h.asUser(admin);
    await h.db.query("select public.claim_student_verification($1)", [id]);
    expect(await h.failure("select public.approve_verification($1, 'CURRENT_STUDENT', null)", [id])).toMatch(/Complete the checklist/);
    const e = await evidenceId(id);
    await h.asUser(admin);
    expect(await h.failure("select public.review_evidence($1, 'validated')", [e])).toMatch(/Inspect the file/);
    await checks(id);
    expect(await h.failure("select public.approve_verification($1, 'CURRENT_STUDENT', null)", [id])).toMatch(/Validate at least one/);
    await h.db.query("select public.set_evidence_scan($1, 'static_ok')", [e]);
    await h.db.query("select public.review_evidence($1, 'validated')", [e]);
    for (const over of [{ issuer: false }, { link: "mismatch" }, { link: "ambiguous" }, { link: "unchecked" }, { enrol: false }, { binding: null }]) {
      await checks(id, over);
      expect(await h.failure("select public.approve_verification($1, 'CURRENT_STUDENT', null)", [id]), JSON.stringify(over)).toMatch(/Complete the checklist/);
    }
    expect(await badges(bob, [alice])).toHaveLength(0);
  });

  it("does not trust a forged document: a quarantined file cannot be validated and nothing is auto-approved", async () => {
    const id = await submitted(alice);
    await h.asUser(admin);
    await h.db.query("select public.claim_student_verification($1)", [id]);
    const e = await evidenceId(id);
    await h.asUser(admin);
    await h.db.query("select public.set_evidence_scan($1, 'quarantined')", [e]);
    expect(await h.failure("select public.review_evidence($1, 'validated')", [e])).toMatch(/Inspect the file/);
    expect(await status(id)).toBe("UNDER_REVIEW");
    expect(await badges(bob, [alice])).toHaveLength(0);
  });

  it("accepts a confirmed registrar response instead of a file", async () => {
    const id = await start(alice, "CURRENT_STUDENT", null, "laval", "REGISTRAR_CONFIRMATION");
    await h.db.query("select public.skip_email_step($1)", [id]);
    await h.db.query("select public.submit_student_verification($1, $2)", [id, CONSENT]);
    await h.asUser(admin);
    await h.db.query("select public.claim_student_verification($1)", [id]);
    await checks(id, { registrar: "ambiguous" });
    expect(await h.failure("select public.approve_verification($1, 'CURRENT_STUDENT', null)", [id])).toMatch(/Validate at least one/);
    await checks(id, { registrar: "confirmed" });
    await approve(id);
    expect(await badges(bob, [alice])).toHaveLength(1);
  });

  it("TESTS 12-13: ordinary members cannot review, approve, read documents or impersonate staff", async () => {
    const id = await submitted(alice);
    await h.asUser(bob);
    for (const sql of [
      `select public.claim_student_verification('${id}')`,
      `select public.approve_verification('${id}', 'CURRENT_STUDENT', null)`,
      `select public.reject_verification('${id}', 'other')`,
      `select public.request_more_information('${id}', 'hello')`,
      `select public.set_evidence_scan(gen_random_uuid(), 'static_ok')`,
      `select public.revoke_student_credential(gen_random_uuid(), 'other')`,
      `select public.expire_student_credentials()`,
      `select * from public.verification_notice_recipient('${id}')`,
      `select * from public.due_evidence_deletions()`,
    ]) {
      expect(await h.failure(sql), sql).toMatch(/Not allowed/);
    }
    expect(await h.failure("insert into public.staff_roles (user_id, role) values ($1, 'admin')", [bob])).toMatch(/permission denied/i);
    await h.asUser(alice); // the owner of the request is not a reviewer either
    expect(await h.failure(`select public.approve_verification('${id}', 'CURRENT_STUDENT', null)`)).toMatch(/Not allowed/);
  });

  it("an administrator cannot review their own request, nor approve one under someone else's review", async () => {
    const mine = await submitted(admin);
    await h.asUser(admin);
    expect(await h.failure("select public.claim_student_verification($1)", [mine])).toMatch(/your own request/);

    const id = await submitted(alice);
    await h.asOwner();
    await h.db.query("insert into public.staff_roles (user_id, role) values ($1, 'admin')", [carol]);
    await review(id);
    await h.asUser(carol);
    expect(await h.failure("select public.approve_verification($1, 'CURRENT_STUDENT', null)", [id])).toMatch(/not under your review/);
  });

  it("TEST 14: conflicting decisions never produce duplicate or inconsistent credentials", async () => {
    const id = await submitted(alice);
    await review(id);
    await h.asUser(admin);
    await approve(id);
    expect(await h.failure("select public.approve_verification($1, 'CURRENT_STUDENT', null)", [id])).toMatch(/not under your review/);
    expect(await h.failure("select public.reject_verification($1, 'other')", [id])).toMatch(/not under your review/);

    const second = await submitted(alice); // a renewal of the same scope
    await review(second);
    await approve(second);
    await h.asOwner();
    expect(await h.rows("select 1 from public.student_verified_credentials where user_id = $1 and revoked_at is null and expired_at is null", [alice])).toHaveLength(1);
    expect(await h.rows("select 1 from public.student_verified_credentials where user_id = $1", [alice])).toHaveLength(2);
    expect(await h.failure("insert into public.student_verified_credentials (user_id, institution_id, claim_type, issuer, verification_method, expires_at) select $1, id, 'CURRENT_STUDENT', 'x', 'OFFICIAL_ATTESTATION_REVIEW', now() + interval '1 day' from public.academic_institutions where slug = 'udem'", [alice])).toMatch(/svc_one_active_scope/);
  });

  it("a duplicate identity binding cannot verify a second account", async () => {
    const a = await submitted(alice);
    await review(a, { binding: "shared-binding-0123456789" });
    await approve(a);
    const b = await submitted(bob);
    await review(b, { binding: "shared-binding-0123456789" });
    await h.asUser(admin);
    expect(await h.failure("select public.approve_verification($1, 'CURRENT_STUDENT', null)", [b])).toMatch(/already verified on another account/);
    expect(await badges(alice, [bob])).toHaveLength(0);
  });

  it("supports several credentials on one account", async () => {
    const udem = await submitted(alice);
    await review(udem, { binding: "binding-udem-0123456789" });
    await approve(udem);
    const mcgill = await submitted(alice, "CURRENT_STUDENT", null, "mcgill");
    await review(mcgill, { binding: "binding-mcgill-0123456789" });
    await approve(mcgill);
    expect((await badges(bob, [alice])).map((r) => r.institution_name).sort()).toEqual(["McGill University", "Université de Montréal"]);
  });

  it("'more information' and rejection notify the member, can be retried, and never issue a badge", async () => {
    const id = await submitted(alice);
    await h.asUser(admin);
    await h.db.query("select public.claim_student_verification($1)", [id]);
    await h.db.query("select public.request_more_information($1, 'Please share the current term')", [id]);
    await h.asUser(alice);
    expect((await h.rows<{ student_message: string }>("select student_message from public.student_verification_requests where id = $1", [id]))[0].student_message).toBe("Please share the current term");
    await h.db.query("select public.submit_student_verification($1, $2)", [id, CONSENT]);
    await h.asUser(admin);
    await h.db.query("select public.claim_student_verification($1)", [id]);
    await h.db.query("select public.reject_verification($1, 'not_current', 'The term has ended')", [id]);
    expect(await status(id)).toBe("REJECTED");
    expect(await badges(bob, [alice])).toHaveLength(0);
    await start(alice); // a new request after a rejection is allowed
  });
});

describe("expiry and revocation", () => {
  async function verified(user = alice, over: Over = {}) {
    const id = await submitted(user);
    await review(id, { binding: `binding-${user}-0123456789`, ...over });
    await approve(id);
    return id;
  }
  const days = async (id: string) =>
    (await h.rows<{ d: number }>("select extract(day from (expires_at - now()))::int as d from public.student_verified_credentials where source_reference_id = $1", [id]))[0].d;

  it("sets the expiry from the confirmed term, caps it, and uses a conservative window when no term is known", async () => {
    const id = await verified(alice, { start: null, end: null });
    await h.asOwner();
    expect(await days(id)).toBeGreaterThanOrEqual(89);
    expect(await days(id)).toBeLessThanOrEqual(90);
    const far = await submitted(bob);
    await review(far, { end: "2099-01-01", binding: "binding-far-0123456789" });
    await approve(far);
    await h.asOwner();
    expect(await days(far)).toBeLessThanOrEqual(365);
    const past = await submitted(carol);
    await review(past, { start: null, end: "2020-01-01", binding: "binding-past-0123456789" });
    await h.asUser(admin);
    expect(await h.failure("select public.approve_verification($1, 'CURRENT_STUDENT', null)", [past])).toMatch(/already ended/);
  });

  it("TESTS 10-11: an expired credential stops being a badge immediately, even before the job runs", async () => {
    const id = await verified();
    expect(await badges(bob, [alice])).toHaveLength(1);
    await h.asOwner();
    await h.db.exec("update public.student_verified_credentials set expires_at = now() - interval '1 second'");
    expect(await badges(bob, [alice])).toHaveLength(0);
    await h.asUser(admin);
    expect((await h.rows<{ n: number }>("select public.expire_student_credentials() as n"))[0].n).toBe(1);
    expect(await status(id)).toBe("EXPIRED");
    expect(await badges(bob, [alice])).toHaveLength(0);
    await h.asUser(alice);
    expect(await h.rows("select 1 from public.notifications where type = 'verification_update'")).toHaveLength(2); // approved + expired
  });

  it("another valid credential keeps the member verified when one expires", async () => {
    await verified();
    const second = await submitted(alice, "CURRENT_STUDENT", null, "mcgill");
    await review(second, { binding: "binding-second-0123456789" });
    await approve(second);
    await h.asOwner();
    await h.db.exec("update public.student_verified_credentials set expires_at = now() - interval '1 second' where institution_id = (select id from public.academic_institutions where slug = 'udem')");
    expect((await badges(bob, [alice])).map((r) => r.institution_name)).toEqual(["McGill University"]);
  });

  it("reminds once before expiry", async () => {
    await verified();
    await h.asOwner();
    await h.db.exec("update public.student_verified_credentials set expires_at = now() + interval '3 days'");
    await h.asUser(admin);
    await h.db.query("select public.expire_student_credentials()");
    await h.db.query("select public.expire_student_credentials()");
    await h.asUser(alice);
    expect(await h.rows("select 1 from public.notifications where type = 'verification_update'")).toHaveLength(2); // approved + one reminder
  });

  it("revocation removes the badge at once and only a reviewer can do it", async () => {
    const id = await verified();
    await h.asOwner();
    const credId = (await h.rows<{ id: string }>("select id from public.student_verified_credentials where source_reference_id = $1", [id]))[0].id;
    await h.asUser(alice);
    expect(await h.failure("select public.revoke_student_credential($1, 'other')", [credId])).toMatch(/Not allowed/);
    await h.asUser(admin);
    await h.db.query("select public.revoke_student_credential($1, 'revoked_error')", [credId]);
    expect(await badges(bob, [alice])).toHaveLength(0);
    expect(await status(id)).toBe("REVOKED");
    await h.asUser(admin);
    expect(await h.failure("select public.revoke_student_credential($1, 'other')", [credId])).toMatch(/not active/);
    expect(await h.failure("select public.set_credential_expiry($1, now() + interval '5 days')", [credId])).toMatch(/not active/);
  });

  it("a reviewer can shorten an expiry but not exceed the maximum lifespan", async () => {
    await verified();
    await h.asOwner();
    const credId = (await h.rows<{ id: string }>("select id from public.student_verified_credentials"))[0].id;
    await h.asUser(admin);
    await h.db.query("select public.set_credential_expiry($1, now() + interval '10 days')", [credId]);
    expect(await h.failure("select public.set_credential_expiry($1, now() + interval '800 days')", [credId])).toMatch(/maximum lifespan/);
    expect(await h.failure("select public.set_credential_expiry($1, now() - interval '1 day')", [credId])).toMatch(/maximum lifespan/);
  });

  it("deleting an account removes its verification records without being blocked by the append-only logs", async () => {
    await h.asOwner();
    await h.db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'z@example.com', '{\"first_name\":\"Zed\"}')", [ZED]);
    await h.db.query("update public.profiles set username = 'zed_z', member_type = 'educator', fields = array['nursing'], career_stage = 'mid_career', country = 'CA', onboarding_completed = true where id = $1", [ZED]);
    const id = await submitted(ZED);
    await h.asOwner();
    await h.db.exec("select private.vaudit('verification.test', 'request', null, '{}')");
    expect(await h.failure("delete from public.profiles where id = $1", [ZED])).toBeNull();
    expect(await h.rows("select 1 from public.student_verification_requests where id = $1", [id])).toHaveLength(0);
    expect(await h.failure("delete from public.verification_audit_log")).toMatch(/append-only/);
  });
});

describe("evidence files", () => {
  const put = (user: string, request: string, file = "a.pdf") =>
    h.db.query("insert into storage.objects (bucket_id, name) values ('student-verification-evidence', $1)", [`${user}/${request}/${file}`]);
  const insertSql = "insert into storage.objects (bucket_id, name) values ('student-verification-evidence', $1)";

  it("is private, size and type limited", async () => {
    await h.asOwner();
    const b = (await h.rows<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'student-verification-evidence'"))[0];
    expect(b.public).toBe(false);
    expect(Number(b.file_size_limit)).toBe(5242880);
    expect([...b.allowed_mime_types].sort()).toEqual(["application/pdf", "image/jpeg", "image/png"]);
  });

  it("lets only the owner upload, and only into their own request folder while evidence is open", async () => {
    const id = await start(alice);
    expect(await h.failure(insertSql, [`${alice}/${id}/x.pdf`])).toMatch(/row-level security/i); // still a draft
    await h.db.query("select public.skip_email_step($1)", [id]);
    await put(alice, id);
    await h.asUser(bob);
    expect(await h.failure(insertSql, [`${alice}/${id}/y.pdf`])).toMatch(/row-level security/i);
    expect(await h.failure(insertSql, [`${bob}/${id}/y.pdf`])).toMatch(/row-level security/i);
  });

  it("TEST 12: others cannot read a document; the reviewer only once the request is assigned to them", async () => {
    const id = await start(alice);
    await h.db.query("select public.skip_email_step($1)", [id]);
    await put(alice, id);
    expect(await h.rows("select 1 from storage.objects")).toHaveLength(1);
    await h.asUser(bob);
    expect(await h.rows("select 1 from storage.objects")).toHaveLength(0);
    await h.asUser(admin);
    expect(await h.rows("select 1 from storage.objects")).toHaveLength(0);
    await h.asUser(alice);
    await h.db.query("select public.add_verification_evidence($1, 'official_attestation', $2, 'application/pdf', 10, 'a', null)", [id, `${alice}/${id}/a.pdf`]);
    await h.db.query("select public.submit_student_verification($1, $2)", [id, CONSENT]);
    await h.asUser(admin);
    await h.db.query("select public.claim_student_verification($1)", [id]);
    expect(await h.rows("select 1 from storage.objects")).toHaveLength(1);
  });

  it("retention: due evidence is listed for deletion and then cleared", async () => {
    const id = await submitted(alice);
    await h.asOwner();
    await h.db.exec("update public.student_verification_evidence set retention_delete_at = now() - interval '1 day'");
    await h.asUser(admin);
    const due = await h.rows<{ id: string; private_storage_path: string }>("select * from public.due_evidence_deletions()");
    expect(due).toHaveLength(1);
    expect(due[0].private_storage_path).toBe(`${alice}/${id}/file.pdf`);
    expect((await h.rows<{ n: number }>("select public.mark_evidence_deleted($1::uuid[]) as n", [[due[0].id]]))[0].n).toBe(1);
    expect(await h.rows("select 1 from public.due_evidence_deletions()")).toHaveLength(0);
    await h.asOwner();
    expect((await h.rows<{ private_storage_path: string | null }>("select private_storage_path from public.student_verification_evidence"))[0].private_storage_path).toBeNull();
  });
});
