import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  changedFields,
  channelReady,
  fullFields,
  isCredentialGap,
  isCredentialsUnavailable,
  normalizeCredentials,
  normalizeSchema,
  readStorage,
} from "./credentials.ts";

const schemaData = {
  channels: [
    {
      id: "pangle",
      label: "穿山甲",
      fields: [
        { key: "PANGLE_USER_ID", label: "User ID", secret: false, required: true, input: "text" },
        { key: "PANGLE_ROLE_ID", label: "Role ID", secret: false, required: true, input: "text" },
        { key: "PANGLE_SECURE_KEY", label: "Secure Key", secret: true, required: true, input: "password" },
      ],
    },
    {
      id: "ylh",
      label: "优量汇",
      fields: [
        { key: "YLH_MEMBER_ID", label: "Member ID", secret: false, required: true, input: "text" },
        { key: "YLH_SECRET", label: "Secret", secret: true, required: true, input: "password" },
      ],
    },
    {
      id: "demo",
      label: "演示渠道",
      fields: [{ key: "DEMO_TOKEN", label: "Token", secret: true, required: true, input: "text" }],
    },
  ],
};

describe("credential schema", () => {
  it("reads channels and fields from the payload", () => {
    const schema = normalizeSchema(schemaData);
    assert.deepEqual(schema.map((channel) => channel.id), ["pangle", "ylh", "demo"]);
    assert.equal(schema[0].fields[2].input, "password");
    assert.equal(schema[2].fields[0].input, "password");
    assert.equal(schema[2].fields[0].label, "Token");
  });

  it("drops malformed channels and duplicate keys", () => {
    const schema = normalizeSchema({
      channels: [
        { id: "../x", label: "bad", fields: [{ key: "OK", secret: false, required: true }] },
        { id: "ok", fields: [{ key: "A", secret: false }, { key: "A", secret: true }, { key: "bad key" }] },
      ],
    });
    assert.deepEqual(schema.map((channel) => channel.id), ["ok"]);
    assert.deepEqual(schema[0].fields.map((field) => field.key), ["A"]);
  });
});

describe("credential status", () => {
  const schema = normalizeSchema(schemaData);

  it("keeps set and hint, and drops secret plaintext", () => {
    const secret = "super-secret-value";
    const status = normalizeCredentials({
      channels: [
        {
          id: "pangle",
          configured: true,
          fields: {
            PANGLE_USER_ID: { set: true, value: "user-1", hint: "user-1" },
            PANGLE_ROLE_ID: true,
            PANGLE_SECURE_KEY: { set: true, value: secret, hint: "••••ret" },
          },
        },
        {
          id: "demo",
          fields: [{ key: "DEMO_TOKEN", set: true, value: secret, hint: secret }],
        },
      ],
    }, schema);
    const encoded = JSON.stringify(status);
    assert.equal(encoded.includes(secret), false);
    const secure = status[0].fields[2];
    assert.equal(secure.set, true);
    assert.equal(secure.hint, "••••ret");
    assert.equal("value" in secure, false);
    assert.equal(status[0].fields[0].value, "user-1");
    assert.equal(status[0].fields[0].hint, undefined);
    assert.equal(status[2].fields[0].hint, undefined);
    assert.equal(status[1].fields.every((field) => field.set === false), true);
  });

  it("derives configured from required fields", () => {
    const status = normalizeCredentials({
      channels: [{ id: "ylh", fields: [{ key: "YLH_MEMBER_ID", set: true }, { key: "YLH_SECRET", set: false }] }],
    }, schema);
    assert.equal(status[1].configured, false);
    assert.equal(channelReady(schema[1], status[1]), false);
  });
});

describe("credential gap", () => {
  it("matches 50301, CredentialMissing, and gap flags", () => {
    assert.equal(isCredentialGap({ code: 50301, message: "nope" }), true);
    assert.equal(isCredentialGap({ message: "code=50301 CredentialMissingError" }), true);
    assert.equal(isCredentialGap({ gapFlags: ["credential_missing:pangle"] }), true);
    assert.equal(isCredentialGap({ code: 500, message: "boom" }), false);
    assert.equal(isCredentialsUnavailable({ code: 404, message: "code=404 " }), true);
    assert.equal(isCredentialsUnavailable({ message: "code=500 boom" }), false);
  });
});

describe("field maps", () => {
  const fields = [{ key: "A" }, { key: "B" }];

  it("patches dirty keys, including an empty clear, and omits the rest", () => {
    const patch = changedFields(fields, { A: "  next  ", B: "stay" }, new Set(["A"]));
    assert.deepEqual(patch, { A: "next" });
    assert.deepEqual(changedFields(fields, { A: "   " }, new Set(["A"])), { A: "" });
  });

  it("puts every schema field", () => {
    assert.deepEqual(fullFields(fields, { A: "a" }), { A: "a", B: "" });
  });
});

describe("mario list shape", () => {
  const schema = normalizeSchema(schemaData);
  const secret = "do-not-keep";

  it("reads channel id, status, source, hint, and storage without plaintext", () => {
    const data = {
      storage: { dir: "/data/secrets", file: "revenue-credentials.json", exists: true, encrypted: false, load_error: null },
      channels: [{
        channel: "pangle",
        label: "穿山甲",
        status: "partial",
        fields: [
          { key: "PANGLE_USER_ID", set: true, hint: "u***01", source: "file", overridden_by_env: false },
          { key: "PANGLE_ROLE_ID", set: false, hint: null, source: "none", overridden_by_env: false },
          { key: "PANGLE_SECURE_KEY", set: true, hint: "••••", source: "env", overridden_by_env: true, value: secret },
        ],
      }],
    };
    const status = normalizeCredentials(data, schema);
    assert.equal(status[0].statusText, "partial");
    assert.equal(status[0].configured, false);
    assert.equal(status[0].fields[0].source, "file");
    assert.equal(status[0].fields[2].overriddenByEnv, true);
    assert.equal(status[0].fields[2].hint, "••••");
    assert.equal("value" in status[0].fields[2], false);
    assert.equal(JSON.stringify(status).includes(secret), false);
    assert.equal(readStorage(data)?.file, "revenue-credentials.json");
    assert.equal(readStorage(data)?.exists, true);
  });
});
