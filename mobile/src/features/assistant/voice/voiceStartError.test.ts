import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../../lib/api/ApiError";
import { voiceStartError, type VoiceStartStep } from "./voiceStartError";

function apiError(
  changes: Partial<ConstructorParameters<typeof ApiError>[0]> = {},
) {
  return new ApiError({
    statusCode: 503,
    errorCode: 12501,
    errorKey: "voice_provider_unavailable",
    message: "private upstream body, SDP, credential and URL",
    ...changes,
  });
}

test("provider rejection preserves validated provider diagnostics without exposing server prose", () => {
  const result = voiceStartError(
    apiError({
      details: {
        stage: "provider_create",
        reason: "private reason body",
        provider: "openai",
        provider_status: 400,
        provider_code: "invalid_value",
        provider_type: "invalid_request_error",
        provider_param: "session.audio.input.format",
        provider_message: "secret body must never appear",
      },
    }),
    "server",
  );
  assert.equal(
    result,
    "Voice provider rejected the session (OpenAI 400: invalid_value · session.audio.input.format · code 12501)",
  );
  assert.equal(/private|secret/.test(result), false);
});

test("all backend startup stages map to fixed copy and retain an actionable stage", () => {
  const stages = {
    flag: "Voice is not enabled for this account",
    thread: "Voice is unavailable for this conversation",
    origin: "Voice origin was refused",
    credential: "Voice credential is unavailable or not authorized",
    billing_reservation: "Voice billing could not be reserved",
    provider_create: "Voice provider could not create the session",
    provider_answer: "Voice provider returned an invalid session answer",
    transport: "Voice transport could not connect",
  };
  for (const [stage, copy] of Object.entries(stages)) {
    assert.equal(
      voiceStartError(
        apiError({ details: { stage, reason: "private" } }),
        "server",
      ),
      `${copy} (${stage} · code 12501)`,
    );
  }
});

test("billing and conflict messages use mobile numeric fields instead of raw API text", () => {
  for (const [errorCode, message] of [
    [11300, "Insufficient voice credits"],
    [11307, "Voice billing wallet is suspended"],
    [11301, "Voice billing is unavailable"],
    [11302, "Voice billing is unavailable"],
    [12500, "Voice is busy"],
  ] as const) {
    const result = voiceStartError(apiError({ errorCode }), "server");
    assert.ok(result.startsWith(message), result);
    assert.ok(result.includes(`code ${errorCode}`), result);
    assert.equal(result.includes("private"), false);
  }
  const conflict = voiceStartError(apiError({ statusCode: 409 }), "server");
  assert.match(conflict, /Another voice call is active/);
  assert.match(conflict, /HTTP 409/);
});

test("unknown or malformed diagnostic structures cannot display their fields", () => {
  for (const details of [
    undefined,
    "private",
    { stage: "private", reason: "private", provider: "openai" },
    { stage: "provider_create", reason: "private", provider: "private" },
    { stage: "provider_create", reason: "private", provider_status: 999 },
    {
      stage: "provider_create",
      reason: "private",
      provider_code: "https://private",
    },
    {
      stage: "provider_create",
      reason: "private",
      provider_code: "private words",
    },
    {
      stage: "provider_create",
      reason: "private",
      provider_code: "a".repeat(129),
    },
    {
      stage: "provider_create",
      reason: "private",
      provider_param: { secret: true },
    },
  ]) {
    const result = voiceStartError(apiError({ details }), "server");
    assert.equal(result.includes("private"), false);
    assert.equal(result.includes("secret"), false);
    assert.match(result, /HTTP 503 · code 12501/);
  }
});

test("credential-shaped diagnostic identifiers are excluded even when contract syntax matches", () => {
  for (const identifier of ["sk_private", "nyx_private", "BearerPrivate"]) {
    const result = voiceStartError(
      apiError({
        details: {
          stage: "transport",
          reason: "private",
          provider: "xai",
          provider_status: 502,
          provider_code: identifier,
          provider_type: "server_error",
          provider_param: identifier,
        },
      }),
      "server",
    );
    assert.equal(result.includes(identifier), false);
    assert.equal(
      result,
      "Voice transport could not connect (xAI 502: server_error · code 12501)",
    );
  }
});

test("HTTP authorization, validation and rate-limit failures retain bounded safe diagnoses", () => {
  for (const [statusCode, match] of [
    [401, /session has expired/],
    [403, /access was refused/],
    [400, /settings were rejected/],
    [422, /settings were rejected/],
    [429, /Too many voice requests/],
  ] as const) {
    const result = voiceStartError(apiError({ statusCode }), "server");
    assert.match(result, match);
    assert.equal(result.includes("private"), false);
    assert.ok(result.includes(`HTTP ${statusCode}`));
  }
});

test("local startup stages never display arbitrary media, SDP, socket or network error messages", () => {
  const expected: Record<VoiceStartStep, string> = {
    microphone: "Microphone could not be opened",
    webrtc: "WebRTC negotiation failed",
    server:
      "Voice server could not be reached. Check the active call before trying again.",
    response: "Voice server returned an invalid session answer",
    transport: "Voice control connection could not open",
  };
  for (const [step, message] of Object.entries(expected)) {
    assert.equal(
      voiceStartError(new Error("private details"), step as VoiceStartStep),
      message,
    );
    assert.equal(
      voiceStartError(
        { message: "private", details: "secret" },
        step as VoiceStartStep,
      ),
      message,
    );
  }
  const denial = new Error("private microphone identifier");
  denial.name = "NotAllowedError";
  assert.equal(
    voiceStartError(denial, "microphone"),
    "Microphone permission was denied",
  );
  denial.name = "NotFoundError";
  assert.equal(voiceStartError(denial, "microphone"), "No microphone found");
});
