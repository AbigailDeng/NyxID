import { z } from "zod";
import {
  configurationSchema,
  monitoringResponseSchema,
  monitoringResultSchema,
  MONITORING_FEATURE,
  type MonitoringChecks,
} from "./monitoringContracts";

export const consoleIdentitySchema = z.object({
  id: z.string().min(1),
  is_admin: z.boolean(),
  is_operator: z.boolean().optional(),
  role: z.enum(["admin", "operator", "user"]).optional(),
  capabilities: z
    .object({
      enabled_features: z.array(z.string()).optional(),
      manage_catalog: z.boolean().optional(),
      manage_tools: z.boolean().optional(),
      read_admin_usage: z.boolean().optional(),
      read_feature_flags: z.boolean().optional(),
    })
    .optional(),
});
export type ConsoleIdentity = z.infer<typeof consoleIdentitySchema>;
export const consoleOrgSchema = z.object({
  id: z.string().min(1),
  slug: z.string().optional(),
  display_name: z.string().nullish(),
  your_role: z.string(),
});
export type ConsoleOrganization = z.infer<typeof consoleOrgSchema>;
type Options = {
  method?: "GET" | "PUT" | "DELETE" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  authorityGuard?: () => void;
  retryOnAuthFailure?: boolean;
};
export type ConsoleRequest = (
  path: string,
  options?: Options,
) => Promise<unknown>;
export type MonitoringOperation =
  | { kind: "probe" }
  | { kind: "validate"; checks: MonitoringChecks }
  | { kind: "save"; revision: number; checks: MonitoringChecks }
  | { kind: "clear"; revision: number };
export class MonitoringReviewRequired extends Error {}

/** Each action re-reads identity and exact-service authority. No credential is handed to Web. */
export function createConsoleApi(request: ConsoleRequest) {
  const identity = async (signal?: AbortSignal, guard?: () => void) => {
    guard?.();
    const user = consoleIdentitySchema.parse(
      await request("/users/me", { signal, authorityGuard: guard }),
    );
    guard?.();
    return user;
  };
  const read = async (
    id: string,
    signal?: AbortSignal,
    guard?: () => void,
    expectedIdentity?: string,
  ) => {
    const user = await identity(signal, guard);
    if (expectedIdentity && user.id !== expectedIdentity)
      throw new MonitoringReviewRequired(
        "Account changed. Reload before continuing.",
      );
    if (!user.capabilities?.enabled_features?.includes(MONITORING_FEATURE))
      return null;
    const response = monitoringResponseSchema.parse(
      await request(`/keys/${encodeURIComponent(id)}/monitoring`, {
        signal,
        authorityGuard: guard,
      }),
    );
    guard?.();
    if (
      response.service_id !== id ||
      response.status.service.id !== id ||
      (response.configuration && response.configuration.user_service_id !== id)
    )
      throw new Error(
        "Monitoring returned a different connection. Reload before continuing.",
      );
    return { user, response };
  };
  return {
    identity,
    async organizations(signal?: AbortSignal, guard?: () => void) {
      guard?.();
      const orgs = z
        .object({ orgs: z.array(consoleOrgSchema) })
        .parse(await request("/orgs", { signal, authorityGuard: guard })).orgs;
      guard?.();
      return orgs;
    },
    readMonitoring: read,
    async operate(
      id: string,
      userId: string,
      input: MonitoringOperation,
      guard?: () => void,
    ) {
      const latest = await read(id, undefined, guard, userId);
      if (!latest)
        throw new MonitoringReviewRequired(
          "Monitoring is no longer enabled. Refresh before continuing.",
        );
      const data = latest.response;
      if (
        (input.kind === "probe" || input.kind === "validate") &&
        !data.can_probe
      )
        throw new MonitoringReviewRequired(
          "You no longer have permission to run checks. Refresh before continuing.",
        );
      if (input.kind !== "probe" && !data.can_manage)
        throw new MonitoringReviewRequired(
          "You no longer have permission to configure monitoring. Refresh before continuing.",
        );
      if (
        (input.kind === "save" || input.kind === "clear") &&
        (!data.configuration || data.configuration.revision !== input.revision)
      )
        throw new MonitoringReviewRequired(
          "Configuration changed in another editor. Reload and review the latest values before saving.",
        );
      if (
        input.kind === "validate" &&
        !input.checks.health &&
        !input.checks.readiness
      )
        throw new Error("Enable at least one check to test a draft.");
      guard?.();
      const path = `/keys/${encodeURIComponent(id)}/monitoring`;
      const options = { authorityGuard: guard, retryOnAuthFailure: false };
      const raw =
        input.kind === "probe"
          ? await request(`${path}/probe`, { ...options, method: "POST" })
          : input.kind === "validate"
            ? await request(`${path}/validate`, {
                ...options,
                method: "POST",
                body: input.checks,
              })
            : input.kind === "save"
              ? await request(path, {
                  ...options,
                  method: "PUT",
                  body: { revision: input.revision, ...input.checks },
                })
              : await request(`${path}?revision=${input.revision}`, {
                  ...options,
                  method: "DELETE",
                });
      guard?.();
      if (input.kind === "save" || input.kind === "clear") {
        const result = configurationSchema.parse(raw);
        if (result.user_service_id !== id)
          throw new Error(
            "Configuration returned a different connection. Refresh before continuing.",
          );
        return { kind: "configuration" as const, result };
      }
      const result = monitoringResultSchema.parse(raw);
      if (result.service.id !== id)
        throw new Error(
          "Check returned a different connection. Refresh before continuing.",
        );
      return { kind: input.kind, result };
    },
  };
}
