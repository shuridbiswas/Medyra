// @vitest-environment node
//
// Provider attempts inside the real request -> review -> credential flow, and the trusted writer.
// Every person is fictional; the only provider used is the development simulator.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, ids, type Harness } from "./helpers";

let h: Harness;
const { alice, bob, admin } = ids;
const CONSENT = "student-verification-2026-11-draft";
const KEY = "k".repeat(40) + "-test-writer-key";
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

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
    delete from public.verification_attempts; delete from public.verification_writer_keys;
    update public.verification_provider_configs set claims = '{CURRENT_STUDENT}', enabled = (provider = 'simulated'),
      contract_state = case provider when 'simulated' then 'sandbox' else 'none' end;
  `);
  await h.db.query("insert into public.verification_writer_keys (key_hash, label) values (encode(sha256(convert_to($1,'UTF8')),'hex'), 'test')", [KEY]);
});

const inst = async () => (await h.rows<{ id: string }>("select id from public.academic_institutions where slug = 'udem'"))[0].id;
async function request(user: string) {
  const i = await inst();
  await h.asUser(user);
  return (await h.rows<{ id: string }>("select public.start_provider_request($1) as id", [i]))[0].id;
}
async function attempt(user: string, req: string, pid: string | null = null, provider = "simulated") {
  await h.asUser(user);
  const id = (await h.rows<{ id: string }>("select public.start_provider_attempt($1,$2,$3) as id", [req, provider, pid]))[0].id;
  await h.db.query("select public.set_attempt_progress($1,'redirected')", [id]);
  return id;
}
const attemptState = async (id: string) => {
  await h.asOwner();
  return (await h.rows<{ state: string }>("select state from public.verification_attempts where id = $1", [id]))[0].state;
};
/** The trusted writer, as the web server's anonymous connection. */
async function ingest(pid: string, over: Record<string, unknown> = {}, key: string | null = KEY) {
  const v = { event: "ev-1", outcome: "positive", state: "proof_received", linkage: "strong", issuer: true, until: day(60), subject: "sim-subject-0123456789", digest: null, ...over };
  await h.asUser(null);
  return h.db.query("select public.ingest_provider_result($1,'simulated',$2,$3,$4,$5,$6,$7,$8,$9,$10) as s", [key, pid, v.event, v.outcome, v.state, v.linkage, v.issuer, v.until, v.subject, v.digest]);
}
const ingestFail = async (pid: string, over: Record<string, unknown> = {}, key: string | null = KEY) => {
  try {
    await ingest(pid, over, key);
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};

describe("attempts are linked to the member's own request", () => {
  it("an attempt carries its request and the same owner", async () => {
    const r = await request(alice);
    const a = await attempt(alice, r);
    await h.asOwner();
    const row = (await h.rows<{ request_id: string; user_id: string }>("select request_id, user_id from public.verification_attempts where id = $1", [a]))[0];
    expect(row).toEqual({ request_id: r, user_id: alice });
  });
  it("a member cannot start an attempt on someone else's request", async () => {
    const r = await request(alice);
    await h.asUser(bob);
    expect(await h.failure("select public.start_provider_attempt($1,'simulated',null)", [r])).toMatch(/not found/i);
  });
  it("the database refuses an attempt whose owner differs from the request's owner", async () => {
    const r = await request(alice);
    await h.asOwner();
    expect(await h.failure(
      "insert into public.verification_attempts (user_id, request_id, institution_id, provider, claim_type, environment) values ($1,$2,$3,'simulated','CURRENT_STUDENT','development')",
      [bob, r, await inst()])).toMatch(/va_request_fk/);
  });
  it("a retry keeps the history on one request", async () => {
    const r = await request(alice);
    const first = await attempt(alice, r);
    await h.asUser(alice);
    await h.db.query("select public.set_attempt_progress($1,'cancelled')", [first]);
    expect(await request(alice)).toBe(r); // the open request is reused
    const second = await attempt(alice, r);
    await h.asUser(alice);
    expect((await h.rows("select id from public.verification_attempts where request_id = $1", [r])).length).toBe(2);
    expect(await attemptState(first)).toBe("cancelled");
    expect(await attemptState(second)).toBe("redirected");
  });
  it("withdrawing the request cancels its open attempts", async () => {
    const r = await request(alice);
    const a = await attempt(alice, r);
    await h.asUser(alice);
    await h.db.query("select public.withdraw_student_verification($1)", [r]);
    expect(await attemptState(a)).toBe("cancelled");
  });
  it("a provider request can only ask for the general student claim", async () => {
    await h.asOwner();
    expect(await h.failure(
      "insert into public.student_verification_requests (user_id, institution_id, requested_claim_type, requested_program_id, method) values ($1,$2,'CURRENT_PROGRAM_STUDENT',gen_random_uuid(),'PROVIDER_VERIFICATION')",
      [alice, await inst()])).toBeTruthy();
  });
});

describe("trusted writer", () => {
  it("refuses a missing, short, wrong or revoked key, and the browser roles cannot read the key table", async () => {
    const r = await request(alice);
    await attempt(alice, r, "pid-1");
    for (const key of [null, "short", "x".repeat(50)]) expect(await ingestFail("pid-1", {}, key)).toMatch(/Not allowed/);
    await h.asOwner();
    await h.db.exec("update public.verification_writer_keys set revoked_at = now()");
    expect(await ingestFail("pid-1")).toMatch(/Not allowed/);
    await h.asUser(alice);
    expect(await h.failure("select * from public.verification_writer_keys")).toMatch(/permission denied/);
    await h.asUser(null);
    expect(await h.failure("select * from public.verification_writer_keys")).toMatch(/permission denied/);
  });
  it("an unknown provider verification id is refused, never created", async () => {
    expect(await ingestFail("does-not-exist")).toMatch(/Not found/);
  });
  it("records a result on the matching attempt and makes a reviewer-visible evidence row, not a credential", async () => {
    const r = await request(alice);
    const a = await attempt(alice, r, "pid-1");
    await ingest("pid-1");
    expect(await attemptState(a)).toBe("proof_received");
    await h.asOwner();
    const ev = await h.rows<{ evidence_type: string; validation_status: string }>("select evidence_type, validation_status from public.student_verification_evidence where request_id = $1", [r]);
    expect(ev).toEqual([{ evidence_type: "provider_result", validation_status: "pending" }]);
    expect(await h.rows("select 1 from public.student_verified_credentials")).toHaveLength(0);
  });
  it("duplicate deliveries change nothing", async () => {
    const r = await request(alice);
    await attempt(alice, r, "pid-1");
    await ingest("pid-1");
    await ingest("pid-1");
    await ingest("pid-1", { event: "ev-1", state: "rejected", outcome: "negative" });
    await h.asOwner();
    expect(await h.rows("select 1 from public.verification_provider_events")).toHaveLength(1);
    expect(await h.rows("select 1 from public.student_verification_evidence where request_id = $1", [r])).toHaveLength(1);
  });
  it("out-of-order events never move an attempt backwards", async () => {
    const r = await request(alice);
    const a = await attempt(alice, r, "pid-1");
    await ingest("pid-1", { event: "e-ok" });
    await ingest("pid-1", { event: "e-late-pending", state: "provider_pending", outcome: "indeterminate" });
    await ingest("pid-1", { event: "e-late-review", state: "requires_review", outcome: "positive" });
    await ingest("pid-1", { event: "e-late-error", state: "provider_error", outcome: "indeterminate" });
    expect(await attemptState(a)).toBe("proof_received");
    // a terminal rejection is not overwritten by a later success either
    const r2 = await request(bob);
    const b = await attempt(bob, r2, "pid-2");
    await ingest("pid-2", { event: "b1", state: "rejected", outcome: "negative", subject: null });
    await ingest("pid-2", { event: "b2", subject: "another-subject-0123456789" });
    expect(await attemptState(b)).toBe("rejected");
  });
  it("review can be followed by success once the provider finishes", async () => {
    const r = await request(alice);
    const a = await attempt(alice, r, "pid-1");
    await ingest("pid-1", { event: "p", state: "provider_pending", outcome: "indeterminate", subject: null });
    await ingest("pid-1", { event: "r", state: "requires_review", linkage: "partial", subject: null });
    await ingest("pid-1", { event: "s" });
    expect(await attemptState(a)).toBe("proof_received");
  });
  it("one provider identity cannot back two accounts", async () => {
    await attempt(alice, await request(alice), "pid-1");
    await attempt(bob, await request(bob), "pid-2");
    await ingest("pid-1");
    expect(await ingestFail("pid-2", { event: "x" })).toMatch(/already linked/);
  });
  it("cannot record on a cancelled attempt", async () => {
    const a = await attempt(alice, await request(alice), "pid-1");
    await h.asUser(alice);
    await h.db.query("select public.set_attempt_progress($1,'cancelled')", [a]);
    expect(await ingestFail("pid-1")).toMatch(/no longer/);
  });
});

describe("end to end (simulated): request, provider result, review, credential, badge, revocation", () => {
  const badges = async (u: string) => {
    await h.asUser(bob);
    return h.rows<{ user_id: string; claim_type: string; verification_method: string }>("select user_id, claim_type, verification_method from public.verified_badges($1::uuid[])", [[u]]);
  };

  async function toReview(strong = true) {
    const r = await request(alice);
    const a = await attempt(alice, r, "pid-1");
    await ingest("pid-1", strong ? {} : { state: "requires_review", linkage: "partial", subject: null });
    await h.asUser(alice);
    await h.db.query("select public.submit_student_verification($1,$2)", [r, CONSENT]);
    await h.asUser(admin);
    await h.db.query("select public.claim_student_verification($1)", [r]);
    return { r, a };
  }

  it("a strong simulated result becomes a Verified badge only after a reviewer approves, then can be revoked", async () => {
    const { r, a } = await toReview();
    expect(await badges(alice)).toHaveLength(0);
    await h.asUser(admin);
    await h.db.query("select public.apply_provider_result_to_review($1)", [r]);
    expect(await badges(alice)).toHaveLength(0); // copying the checklist is not approval
    await h.asUser(admin);
    const cid = (await h.rows<{ c: string }>("select public.approve_verification($1,'CURRENT_STUDENT') as c", [r]))[0].c;
    const b = await badges(alice);
    expect(b).toEqual([{ user_id: alice, claim_type: "CURRENT_STUDENT", verification_method: "PROVIDER_VERIFICATION" }]);
    expect(await attemptState(a)).toBe("approved");
    await h.asOwner();
    expect((await h.rows<{ issuer: string }>("select issuer from public.student_verified_credentials where id = $1", [cid]))[0].issuer).toMatch(/TEST ONLY/);
    await h.asUser(admin);
    await h.db.query("select public.revoke_student_credential($1,'revoked_error')", [cid]);
    expect(await badges(alice)).toHaveLength(0);
    expect(await attemptState(a)).toBe("revoked");
  });
  it("a general student result can never yield a program credential", async () => {
    const { r } = await toReview();
    await h.asUser(admin);
    await h.db.query("select public.apply_provider_result_to_review($1)", [r]);
    expect(await h.failure("select public.approve_verification($1,'CURRENT_PROGRAM_STUDENT')", [r])).toMatch(/did not request a program/);
  });
  it("a weak result is not copied; the reviewer must do the checklist by hand", async () => {
    const { r } = await toReview(false);
    await h.asUser(admin);
    expect(await h.failure("select public.apply_provider_result_to_review($1)", [r])).toMatch(/No provider result is ready/);
    expect(await h.failure("select public.approve_verification($1,'CURRENT_STUDENT')", [r])).toMatch(/checklist/);
  });
  it("test results are refused in production", async () => {
    const { r } = await toReview();
    await h.asOwner();
    await h.db.exec("update public.verification_attempts set environment = 'production'");
    await h.asUser(admin);
    expect(await h.failure("select public.apply_provider_result_to_review($1)", [r])).toMatch(/production/);
  });
  it("an expired proof is not copied", async () => {
    const { r } = await toReview();
    await h.asOwner();
    await h.db.exec("update public.verification_attempts set valid_until = now() - interval '1 day'");
    await h.asUser(admin);
    expect(await h.failure("select public.apply_provider_result_to_review($1)", [r])).toMatch(/not strong enough/);
  });
  it("members cannot apply a result or approve", async () => {
    const { r } = await toReview();
    await h.asUser(alice);
    expect(await h.failure("select public.apply_provider_result_to_review($1)", [r])).toMatch(/Not allowed/);
    expect(await h.failure("select public.approve_verification($1,'CURRENT_STUDENT')", [r])).toMatch(/Not allowed/);
  });
  it("another member cannot see the attempt or its result", async () => {
    await toReview();
    await h.asUser(bob);
    expect(await h.rows("select id from public.verification_attempts")).toHaveLength(0);
    expect(await h.rows("select id from public.student_verification_evidence")).toHaveLength(0);
  });
  it("a reviewer cannot approve their own provider request", async () => {
    const r = await request(admin);
    await attempt(admin, r, "pid-9");
    await ingest("pid-9", { subject: "admin-subject-0123456789" });
    await h.asUser(admin);
    await h.db.query("select public.submit_student_verification($1,$2)", [r, CONSENT]);
    expect(await h.failure("select public.claim_student_verification($1)", [r])).toMatch(/your own/);
  });
});
