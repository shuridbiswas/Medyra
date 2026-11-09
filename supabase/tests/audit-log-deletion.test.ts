// @vitest-environment node
//
// audit_logs stays append-only, yet deleting an account that appears in it must work.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, ids, type Harness } from "./helpers";

let h: Harness;
const { bob } = ids;

beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.db.close();
});

describe("audit_logs and account deletion", () => {
  it("clears the actor when the account is deleted, and keeps the entry", async () => {
    await h.asOwner();
    const staff = "00000000-0000-0000-0000-0000000000f2";
    await h.db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'staff@example.com', '{}')", [staff]);
    await h.db.query("insert into public.audit_logs (actor_id, action, target_type) values ($1, 'report.decide', 'report')", [staff]);
    await h.db.query("delete from auth.users where id = $1", [staff]);
    expect(await h.rows("select actor_id, action from public.audit_logs")).toEqual([{ actor_id: null, action: "report.decide" }]);
  });

  it("still refuses every other change", async () => {
    await h.asOwner();
    await h.db.query("insert into public.audit_logs (actor_id, action) values ($1, 'report.decide')", [bob]);
    expect(await h.failure("update public.audit_logs set action = 'changed'")).toMatch(/append-only/i);
    expect(await h.failure("update public.audit_logs set actor_id = null, action = 'changed'")).toMatch(/append-only/i);
    expect(await h.failure("delete from public.audit_logs")).toMatch(/append-only/i);
  });
});
