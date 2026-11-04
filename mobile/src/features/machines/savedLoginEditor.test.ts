import assert from "node:assert/strict";
import test from "node:test";
import {
  createSavedLoginEditorApi,
  savedLoginInputSchema,
  savedLoginReviewed,
  savedLoginReviewRequired,
  SavedLoginOutcomeUnknown,
} from "./savedLoginEditorTransport";

const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const prior = {
  id: "login-id",
  owner_id: USER,
  label: "GitHub",
  allowed_origins: ["https://github.com"],
  has_password: true,
  has_totp: false,
  confirm_each_sign_in: true,
  updated_at: "before",
  created_at: "before",
};
const input = () => ({
  label: "GitHub",
  allowed_origins: ["https://github.com"],
  username: "alice",
  password: "ephemeral-password",
  totp_secret: "",
  confirm_each_sign_in: true,
});

test("login inputs require exact HTTPS origins without paths, wildcards, credentials or queries", () => {
  for (const origin of [
    "http://github.com",
    "https://github.com/login",
    "https://*.example.com",
    "https://user:pass@github.com",
    "https://github.com?q=1",
  ])
    assert.equal(
      savedLoginInputSchema.safeParse({ ...input(), allowed_origins: [origin] })
        .success,
      false,
    );
  assert.equal(savedLoginInputSchema.safeParse(input()).success, true);
});
test("creation uses explicit selected owner and never retains secrets in returned metadata or request objects", async () => {
  const values = input();
  let body: any;
  const api = createSavedLoginEditorApi(async (path, options) => {
    assert.equal(path, `/saved-logins?owner_id=${USER}`);
    assert.equal(options.method, "POST");
    body = options.body;
    assert.equal(body.password, "ephemeral-password");
    assert.equal(body.totp_secret, null);
    return { ...prior, password: "not-returned", username: "not-returned" };
  });
  const result = await api.save(values, USER, USER, () => true);
  assert.equal("password" in result, false);
  assert.equal(values.password, "");
  assert.equal(values.username, "");
  assert.equal(body.password, null);
});
test("replacement refuses drift or a revoked organization role, clearing credentials on every exit", async () => {
  const values = input();
  let writes = 0;
  const api = createSavedLoginEditorApi(async (_path, options) => {
    if (options.method !== "GET") writes++;
    return [{ ...prior, updated_at: "changed" }];
  });
  await assert.rejects(
    api.save(values, USER, USER, () => true, prior),
    /login changed/,
  );
  assert.equal(writes, 0);
  assert.equal(values.password, "");
  await assert.rejects(
    createSavedLoginEditorApi(async () => ({
      orgs: [{ id: ORG, slug: "team", your_role: "member" }],
    })).save(input(), ORG, USER, () => true),
    /Admin access/,
  );
});
test("account or foreground changes during authority reads prevent saving", async () => {
  let current = true;
  let calls = 0;
  const values = input();
  const api = createSavedLoginEditorApi(async () => {
    calls++;
    current = false;
    return [prior];
  });
  await assert.rejects(
    api.save(values, USER, USER, () => current, prior),
    /context changed/,
  );
  assert.equal(calls, 1);
  assert.equal(values.password, "");
});
test("an in-flight save losing foreground remains uncertain across editor remount until metadata is reviewed", async () => {
  let current = true;
  const api = createSavedLoginEditorApi(async (_path, options) => {
    assert.equal(options.method, "POST");
    current = false;
    options.authorityGuard?.();
    return prior;
  });
  await assert.rejects(
    api.save(input(), USER, USER, () => current),
    SavedLoginOutcomeUnknown,
  );
  assert.equal(savedLoginReviewRequired(USER), true);
  savedLoginReviewed(USER);
  assert.equal(savedLoginReviewRequired(USER), false);
});
