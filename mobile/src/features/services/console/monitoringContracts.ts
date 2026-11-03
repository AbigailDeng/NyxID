import { z } from "zod";

export const MONITORING_FEATURE = "services:monitoring";
const checkSchema = z.object({
  path: z.string(),
  expect_status: z.array(z.number().int()),
  body_contains: z.string().optional(),
});
export const configurationSchema = z.object({
  user_service_id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  owner_config: z.object({
    health: checkSchema.nullish().transform((v) => v ?? null),
    readiness: checkSchema.nullish().transform((v) => v ?? null),
  }),
});
const resultCheckSchema = z.object({
  status: z.enum([
    "healthy",
    "unhealthy",
    "ready",
    "not_ready",
    "not_configured",
    "unknown",
  ]),
  source: z.enum(["owner", "builtin", "discovered", "none"]),
  path: z.string(),
  reason: z.string(),
  checked_at: z.string().nullable(),
  duration_ms: z.number().nullable(),
  status_code: z.number().nullable(),
  freshness: z.enum(["fresh", "stale", "unknown"]),
  stale_at: z.string().nullable(),
});
export const monitoringResultSchema = z.object({
  service: z.object({ id: z.string().min(1) }),
  health: resultCheckSchema,
  readiness: resultCheckSchema.nullish().transform((v) => v ?? null),
});
export const monitoringResponseSchema = z.object({
  service_id: z.string().min(1),
  can_manage: z.boolean(),
  can_probe: z.boolean(),
  configuration: configurationSchema.nullable(),
  status: monitoringResultSchema,
});
export type MonitoringConfiguration = z.infer<typeof configurationSchema>;
export type MonitoringChecks = MonitoringConfiguration["owner_config"];
export type MonitoringResult = z.infer<typeof monitoringResultSchema>;
export type MonitoringResponse = z.infer<typeof monitoringResponseSchema>;
export type MonitoringCheckResult = z.infer<typeof resultCheckSchema>;
export type CheckDraft = {
  enabled: boolean;
  path: string;
  statuses: string;
  body: string;
};
export type MonitoringDraft = { health: CheckDraft; readiness: CheckDraft };
const byteLength = (value: string) => new TextEncoder().encode(value).length;

export function safeMonitoringPath(path: string): boolean {
  if (
    !path ||
    byteLength(path) > 512 ||
    path.startsWith("/") ||
    /[:\\?#\s]/.test(path) ||
    /[\x00-\x1f\x7f]/.test(path)
  )
    return false;
  try {
    let decoded = path;
    for (let i = 0; i < 4; i++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    return (
      !decoded.startsWith("/") &&
      decodeURIComponent(decoded) === decoded &&
      !/[:\\?#\s\x00-\x1f\x7f]/.test(decoded) &&
      !decoded
        .split("/")
        .some((segment) =>
          [
            ".",
            "..",
            "create",
            "execute",
            "generate",
            "run",
            "submit",
          ].includes(segment.toLowerCase()),
        )
    );
  } catch {
    return false;
  }
}

export function draftFromConfiguration(
  config: MonitoringConfiguration,
): MonitoringDraft {
  const fields = (check: MonitoringChecks["health"]): CheckDraft => ({
    enabled: Boolean(check),
    path: check?.path ?? "",
    statuses: (check?.expect_status ?? [200]).join(", "),
    body: check?.body_contains ?? "",
  });
  return {
    health: fields(config.owner_config.health),
    readiness: fields(config.owner_config.readiness),
  };
}

export function checksFromDraft(draft: MonitoringDraft): MonitoringChecks {
  const check = (value: CheckDraft) => {
    if (!value.enabled) return null;
    const path = value.path.trim();
    if (!safeMonitoringPath(path))
      throw new Error(
        "Use a safe relative GET path such as healthz. URLs, queries and operation paths are not allowed.",
      );
    const statuses = value.statuses
      .split(",")
      .map((part) => Number(part.trim()));
    if (
      !/^\s*\d{3}(\s*,\s*\d{3})*\s*$/.test(value.statuses) ||
      statuses.length > 8 ||
      new Set(statuses).size !== statuses.length ||
      statuses.some((status) => status < 100 || status > 599)
    )
      throw new Error(
        "Enter up to 8 unique HTTP status codes (100–599), separated by commas.",
      );
    if (byteLength(value.body) > 1024)
      throw new Error("Body expectation must be at most 1,024 UTF-8 bytes.");
    return {
      path,
      expect_status: statuses,
      ...(value.body ? { body_contains: value.body } : {}),
    };
  };
  return { health: check(draft.health), readiness: check(draft.readiness) };
}

/** An observation expires locally without making a network request. */
export function displayedMonitoringStatus(
  check: MonitoringCheckResult | null,
  now = Date.now(),
): MonitoringCheckResult["status"] {
  if (!check) return "not_configured";
  if (check.status === "not_configured") return "not_configured";
  const at = check.checked_at ? Date.parse(check.checked_at) : NaN;
  const staleAt = check.stale_at ? Date.parse(check.stale_at) : NaN;
  if (
    check.freshness !== "fresh" ||
    !Number.isFinite(at) ||
    at > now ||
    !Number.isFinite(staleAt) ||
    staleAt <= at ||
    now >= staleAt ||
    check.reason === "no_health_path"
  )
    return "unknown";
  return check.status;
}
