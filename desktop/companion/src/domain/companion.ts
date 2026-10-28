import { z } from "zod";

export const COMPANION_SCHEMA_VERSION = 2 as const;

const noControlCharacters = (value: string) =>
  !Array.from(value).some((character) => /\p{Cc}/u.test(character));

export const companionSettingsSchema = z.object({
  companionName: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine(noControlCharacters, "Control characters are not allowed"),
  userName: z
    .string()
    .trim()
    .max(80)
    .refine(noControlCharacters, "Control characters are not allowed"),
  onboardingComplete: z.boolean(),
});

export const companionSnapshotSchema = z.object({
  schemaVersion: z.literal(COMPANION_SCHEMA_VERSION),
  settings: companionSettingsSchema,
});

export type CompanionSettings = z.infer<typeof companionSettingsSchema>;
export type CompanionSnapshot = z.infer<typeof companionSnapshotSchema>;

export function createDefaultCompanionSettings(): CompanionSettings {
  return {
    companionName: "Nyx",
    userName: "",
    onboardingComplete: false,
  };
}

export function createDefaultCompanionSnapshot(): CompanionSnapshot {
  return {
    schemaVersion: COMPANION_SCHEMA_VERSION,
    settings: createDefaultCompanionSettings(),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  let normalized = "";
  for (const character of value.trim()) {
    if (!noControlCharacters(character)) continue;
    if (normalized.length + character.length > 80) break;
    normalized += character;
  }
  return normalized.trim() || fallback;
}

export function sanitizeCompanionSettings(
  value: unknown,
  fallback = createDefaultCompanionSettings(),
): CompanionSettings {
  const source = record(value) ?? {};
  return companionSettingsSchema.parse({
    companionName: boundedString(source.companionName, fallback.companionName),
    userName: boundedString(source.userName, fallback.userName),
    onboardingComplete:
      typeof source.onboardingComplete === "boolean"
        ? source.onboardingComplete
        : fallback.onboardingComplete,
  });
}

/** Retains identity preferences from older snapshots and discards retired data. */
export function parseCompanionSnapshot(value: unknown): CompanionSnapshot {
  const source = record(value) ?? {};
  const savedSettings = record(source.settings ?? source.preferences);
  const settings = sanitizeCompanionSettings(savedSettings);
  if (savedSettings?.companionName === "饭点儿") {
    settings.companionName = createDefaultCompanionSettings().companionName;
  }
  return {
    schemaVersion: COMPANION_SCHEMA_VERSION,
    settings,
  };
}

export const migrateCompanionSnapshot = parseCompanionSnapshot;
