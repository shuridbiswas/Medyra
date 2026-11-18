// @vitest-environment node
//
// External-provider attempts: who can start, move and record them, run against the real migrations.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, ids, type Harness } from "./helpers";

let h: Harness;
const { alice, bob, admin } = ids;

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
    delete from public.verification_attempts;
    update public.verification_provider_configs set enabled = false, contract_state = case provider when 'simulated' then 'sandbox' else 'none' end;
  `);
});

const inst = async () => (await h.rows<{ id: string }>("select id from public.academic_institutions limit 1"))[0].id;
async function enable(provider = "simulated") {
  await h.asOwner();
  await h.db.query("update public.verification_provider_configs set contract_state = 'sandbox', enabled = true where provider = $1", [provider]);
}
async function start(user: string, provider = "simulated", claim = "CURRENT_STUDENT", pid: string | null = null) {
  const i = await inst();
  await h.asUser(user);
  return (await h.rows<{ id: string }>("select public.start_provider_attempt($1,$2,$3,$4) as id", [i, provider, claim, pid]))[0].id;
}
const state = async (id: string) => {
  await h.asOwner();
  return (await h.rows<{ state: string }>("select state from public.verification_attempts where id = $1", [id]))[0].state;
};
const record = (attempt: string, over: Partial<Record<string, unknown>> = {}) => {
  const v = { event: "e1", outcome: "positive", state: "proof_received", linkage: "strong", issuer: true, until: null, subject: "subj-1", digest: "d", ...over };
  return h.db.query("select public.record_provider_result($1,$2,$3,$4,$5,$6,$7,$8,$9) as s", [attempt, v.event, v.outcome, v.state, v.linkage, v.issuer, v.until, v.subject, v.digest]);
};

describe("provider configuration", () => {
  it("every real provider starts disabled with no contract", async () => {
    await h.asOwner();
    const r = await h.rows<{ provider: string; enabled: boolean }>("select provider, enabled from public.verification_provider_configs where provider <> 'simulated'");
    expect(r).toHaveLength(5);
    expect(r.every((x) => !x.enabled)).toBe(true);
  });
  it("cannot be enabled without a sandbox or live approval, and the simulator is development only", async () => {
    await h.asOwner();
    expect(await h.failure("update public.verification_provider_configs set enabled = true where provider = 'sheerid'")).toMatch(/vpc_enabled_needs_contract/);
    expect(await h.failure("update public.verification_provider_configs set environment = 'production' where provider = 'simulated'")).toMatch(/vpc_simulated_dev_only/);
  });
  it("members cannot change a configuration; administrators can", async () => {
    await h.asUser(admin);
    await h.db.query("update public.verification_provider_configs set note = 'x' where provider = 'simulated'");
    await h.asUser(alice);
    // RLS filters the row out: no error, no change.
    const r = await h.db.query("update public.verification_provider_configs set note = 'hacked'");
    expect(r.affectedRows).toBe(0);
    await h.asOwner();
    expect((await h.rows<{ note: string }>("select note from public.verification_provider_configs where provider = 'simulated'"))[0].note).toBe("x");
  });
});

describe("starting and moving an attempt", () => {
  it("a disabled or unapproved provider cannot start an attempt", async () => {
    await h.asUser(alice);
    expect(await h.failure("select public.start_provider_attempt($1,'sheerid','CURRENT_STUDENT',null)", [await inst()])).toMatch(/not available/);
    expect(await h.failure("select public.start_provider_attempt($1,'simulated','CURRENT_STUDENT',null)", [await inst()])).toMatch(/not available/);
  });
  it("a claim the provider is not approved for is refused", async () => {
    await enable();
    await h.asUser(alice);
    expect(await h.failure("select public.start_provider_attempt($1,'simulated','CURRENT_PROGRAM_STUDENT',null)", [await inst()])).toMatch(/not available/);
  });
  it("a member starts one, and only one open attempt per provider and claim", async () => {
    await enable();
    const id = await start(alice);
    expect(await state(id)).toBe("created");
    await h.asUser(alice);
    expect(await h.failure("select public.start_provider_attempt($1,'simulated','CURRENT_STUDENT',null)", [await inst()])).toMatch(/open attempt/);
  });
  it("members have no write path to attempts", async () => {
    await enable();
    const id = await start(alice);
    await h.asUser(alice);
    expect(await h.failure("update public.verification_attempts set state = 'approved'")).toMatch(/permission denied/);
    expect(await h.failure("insert into public.verification_attempts (user_id, institution_id, provider, claim_type, environment) values ($1,$2,'simulated','CURRENT_STUDENT','development')", [alice, await inst()])).toMatch(/permission denied/);
    expect(await h.failure("delete from public.verification_attempts")).toMatch(/permission denied/);
    expect(await state(id)).toBe("created");
  });
  it("progress states are harmless and cannot jump to a trusted state", async () => {
    await enable();
    const id = await start(alice);
    await h.asUser(alice);
    for (const s of ["approved", "proof_received", "requires_review", "rejected"])
      expect(await h.failure("select public.set_attempt_progress($1,$2)", [id, s])).toMatch(/not allowed/);
    await h.db.query("select public.set_attempt_progress($1,'redirected')", [id]);
    await h.db.query("select public.set_attempt_progress($1,'provider_pending')", [id]);
    expect(await state(id)).toBe("provider_pending");
  });
  it("another member cannot move or read someone else's attempt", async () => {
    await enable();
    const id = await start(alice);
    await h.asUser(bob);
    expect(await h.failure("select public.set_attempt_progress($1,'cancelled')", [id])).toMatch(/Not found/);
    expect(await h.rows("select id from public.verification_attempts")).toHaveLength(0);
  });
  it("the private subject hash and digest are not readable by the owner", async () => {
    await enable();
    await start(alice);
    await h.asUser(alice);
    expect(await h.failure("select subject_hash from public.verification_attempts")).toMatch(/permission denied/);
    expect(await h.failure("select evidence_digest from public.verification_attempts")).toMatch(/permission denied/);
  });
});

describe("recording a provider result", () => {
  async function pending(user: string = alice, provider = "simulated", pid: string | null = null) {
    await enable(provider);
    const id = await start(user, provider, "CURRENT_STUDENT", pid);
    await h.asUser(user);
    await h.db.query("select public.set_attempt_progress($1,'redirected')", [id]);
    return id;
  }
  it("a member cannot record a result, even for their own attempt", async () => {
    const id = await pending();
    await h.asUser(alice);
    expect(await h.failure("select public.record_provider_result($1,'e','positive','proof_received','strong',true,null,'s','d')", [id])).toMatch(/Not allowed/);
    expect(await state(id)).toBe("redirected");
  });
  it("an administrator records it, never an approval, and it is idempotent", async () => {
    const id = await pending();
    await h.asUser(admin);
    expect(await h.failure("select public.record_provider_result($1,'e','positive','approved','strong',true,null,'s','d')", [id])).toMatch(/not allowed/);
    await record(id);
    expect(await state(id)).toBe("proof_received");
    await record(id, { state: "rejected", outcome: "negative" }); // same event hash: replay changes nothing
    expect(await state(id)).toBe("proof_received");
    await h.asOwner();
    expect(await h.rows("select 1 from public.verification_provider_events")).toHaveLength(1);
  });
  it("one provider identity cannot back two accounts", async () => {
    const a = await pending(alice);
    const b = await pending(bob);
    await h.asUser(admin);
    await record(a, { subject: "same-student" });
    expect(await h.failure("select public.record_provider_result($1,'e1','positive','proof_received','strong',true,null,'same-student','d')", [b])).toMatch(/already linked/);
    expect(await state(b)).toBe("redirected");
  });
  it("a cancelled or expired attempt cannot take a result", async () => {
    const id = await pending();
    await h.asUser(alice);
    await h.db.query("select public.set_attempt_progress($1,'cancelled')", [id]);
    await h.asUser(admin);
    expect(await h.failure("select public.record_provider_result($1,'e','positive','proof_received','strong',true,null,'s','d')", [id])).toMatch(/no longer/);
    const id2 = await pending(bob);
    await h.asOwner();
    await h.db.query("update public.verification_attempts set expires_at = now() - interval '1 hour' where id = $1", [id2]);
    await h.asUser(admin);
    expect(await h.failure("select public.record_provider_result($1,'e','positive','proof_received','strong',true,null,'s2','d')", [id2])).toMatch(/no longer/);
  });
  it("provider events are visible to staff only", async () => {
    const id = await pending();
    await h.asUser(admin);
    await record(id);
    expect(await h.rows("select 1 from public.verification_provider_events")).toHaveLength(1);
    await h.asUser(alice);
    expect(await h.failure("select 1 from public.verification_provider_events")).toBeNull();
    expect(await h.rows("select 1 from public.verification_provider_events")).toHaveLength(0);
  });
  it("recording never creates a credential", async () => {
    const id = await pending();
    await h.asUser(admin);
    await record(id);
    await h.asOwner();
    expect(await h.rows("select 1 from public.student_verified_credentials")).toHaveLength(0);
  });
});
