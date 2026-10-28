import { describe, expect, it } from "vitest";

import {
  COMPANION_SCHEMA_VERSION,
  companionSettingsSchema,
  companionSnapshotSchema,
  createDefaultCompanionSnapshot,
  parseCompanionSnapshot,
} from "./companion";

describe("companion snapshot recovery", () => {
  it.each(["settings", "preferences"])(
    "migrates identity from legacy %s and drops retired data",
    (field) => {
      const snapshot = parseCompanionSnapshot({
        schemaVersion: field === "settings" ? 1 : 0,
        [field]: {
          companionName: "  Orbit  ",
          userName: " Sam ",
          onboardingComplete: true,
          timezone: "UTC",
          budget: "low",
          dietary: ["vegan"],
          avoid: ["peanuts"],
          quietMode: true,
          meals: [{ id: "lunch", time: "12:00", enabled: true }],
        },
        history: [{ mealId: "lunch", action: "accepted" }],
        runtime: { activePrompt: { mealId: "lunch" } },
      });

      expect(snapshot).toEqual({
        schemaVersion: COMPANION_SCHEMA_VERSION,
        settings: {
          companionName: "Orbit",
          userName: "Sam",
          onboardingComplete: true,
        },
      });
      expect(companionSnapshotSchema.safeParse(snapshot).success).toBe(true);
    },
  );

  it("repairs invalid identity fields independently", () => {
    expect(
      parseCompanionSnapshot({
        settings: {
          companionName: 42,
          userName: "  Sam\u0000  ",
          onboardingComplete: "yes",
        },
      }),
    ).toEqual({
      schemaVersion: 2,
      settings: {
        companionName: "Nyx",
        userName: "Sam",
        onboardingComplete: false,
      },
    });
  });

  it("recovers malformed snapshots to defaults", () => {
    for (const value of [null, undefined, [], "invalid", { settings: [] }]) {
      expect(parseCompanionSnapshot(value)).toEqual(
        createDefaultCompanionSnapshot(),
      );
    }
  });

  it("bounds Unicode names without splitting characters", () => {
    const snapshot = parseCompanionSnapshot({
      settings: {
        companionName: "小".repeat(100),
        userName: "🙂".repeat(100),
      },
    });

    expect(snapshot.settings.companionName).toBe("小".repeat(80));
    expect(snapshot.settings.userName).toBe("🙂".repeat(40));
    expect(companionSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("rejects invalid settings submitted by the editor", () => {
    const defaults = createDefaultCompanionSnapshot().settings;
    expect(
      companionSettingsSchema.safeParse({ ...defaults, companionName: " " })
        .success,
    ).toBe(false);
    expect(
      companionSettingsSchema.safeParse({ ...defaults, userName: "Sam\u0000" })
        .success,
    ).toBe(false);
  });
});
