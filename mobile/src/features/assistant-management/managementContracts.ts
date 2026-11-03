import { z } from "zod";
import { automationTimezoneSchema } from "../automations/automationContracts";

export const assistantSettingsSchema = z.object({
  timezone: z.string().nullish(),
  schedule_minimum_minutes: z.number().int().min(5).default(5),
  trigger_runs_per_hour: z.number().int().positive().default(30),
  trigger_runs_per_day: z.number().int().positive().default(300),
  max_auto_continuations: z.number().int().min(0).max(32).default(8),
  max_auto_continuations_limit: z.number().int().nonnegative().default(32),
  max_live_subagents: z.number().int().nonnegative(),
  max_concurrent_subagent_turns: z.number().int().nonnegative(),
  max_live_subagents_limit: z.number().int().nonnegative(),
  max_concurrent_subagent_turns_limit: z.number().int().positive(),
  max_group_handoffs: z.number().int().nonnegative().default(6),
  max_group_handoffs_per_hour: z.number().int().nonnegative().default(60),
  max_group_handoffs_limit: z.number().int().nonnegative().default(24),
  max_group_handoffs_per_hour_limit: z
    .number()
    .int()
    .nonnegative()
    .default(600),
  specialist_access_requests: z
    .enum(["denied", "routed_to_nyxbot"])
    .default("denied"),
});
export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;
export const settingFields = [
  "max_auto_continuations",
  "max_live_subagents",
  "max_concurrent_subagent_turns",
  "max_group_handoffs",
  "max_group_handoffs_per_hour",
  "schedule_minimum_minutes",
  "trigger_runs_per_hour",
  "trigger_runs_per_day",
] as const;
export type SettingField = (typeof settingFields)[number];
export type SettingsForm = Record<
  SettingField | "timezone" | "specialist_access_requests",
  string
>;
export type SettingsPatch = Partial<
  Pick<AssistantSettings, keyof SettingsForm>
>;

export const managedChannelsSchema = z.object({
  channel_agents: z.array(
    z.object({
      id: z.string(),
      channel_bot_id: z.string(),
      platform: z.string(),
      bot_label: z.string(),
      status: z.string(),
      agent_id: z.string().nullish(),
      org_id: z.string().nullish(),
      owner_linked: z.boolean(),
      last_error: z.string().nullish(),
      delivery_status: z.string().nullish(),
      delivery_reason: z.string().nullish(),
    }),
  ),
});

export function settingsForm(
  settings: AssistantSettings,
  fallbackZone: string,
): SettingsForm {
  return {
    ...Object.fromEntries(
      settingFields.map((field) => [field, String(settings[field])]),
    ),
    timezone: settings.timezone ?? fallbackZone,
    specialist_access_requests: settings.specialist_access_requests,
  } as SettingsForm;
}

/** Validate against current server ceilings and send only fields the user changed. */
export function settingsPatch(
  form: SettingsForm,
  baseline: SettingsForm,
  limits: AssistantSettings,
): SettingsPatch {
  const ceiling: Record<SettingField, [number, number]> = {
    max_auto_continuations: [
      0,
      Math.min(32, limits.max_auto_continuations_limit),
    ],
    max_live_subagents: [0, limits.max_live_subagents_limit],
    max_concurrent_subagent_turns: [
      1,
      limits.max_concurrent_subagent_turns_limit,
    ],
    max_group_handoffs: [0, limits.max_group_handoffs_limit],
    max_group_handoffs_per_hour: [0, limits.max_group_handoffs_per_hour_limit],
    schedule_minimum_minutes: [5, 1440],
    trigger_runs_per_hour: [1, 300],
    trigger_runs_per_day: [1, 3000],
  };
  const patch: Record<string, string | number> = {};
  for (const field of settingFields) {
    if (form[field] === baseline[field]) continue;
    const [min, max] = ceiling[field];
    if (
      !/^\d+$/.test(form[field]) ||
      !Number.isSafeInteger(Number(form[field])) ||
      Number(form[field]) < min ||
      Number(form[field]) > max
    )
      throw new Error(
        `${field.replaceAll("_", " ")}: enter a whole number from ${min} to ${max}.`,
      );
    patch[field] = Number(form[field]);
  }
  if (form.timezone !== baseline.timezone)
    patch.timezone = automationTimezoneSchema.parse(form.timezone);
  if (form.specialist_access_requests !== baseline.specialist_access_requests)
    patch.specialist_access_requests = z
      .enum(["denied", "routed_to_nyxbot"])
      .parse(form.specialist_access_requests);
  return patch as SettingsPatch;
}

const reference = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !/[\s\u0000-\u001f\u007f]/.test(value));
export type ManagementTarget =
  | {
      kind: "automations";
      agentId?: string;
      automationId?: string;
      create?: boolean;
      setupId?: string;
    }
  | { kind: "skills"; agentId: string }
  | { kind: "channels" }
  | { kind: "bots"; botId?: string }
  | { kind: "templates" }
  | { kind: "setups" }
  | { kind: "personal-binding" };

/** Construct only known first-party routes. No credential or arbitrary return URL crosses. */
export function managementUrl(
  frontendUrl: string,
  target: ManagementTarget,
): string {
  const base = new URL(frontendUrl);
  if (base.protocol !== "https:" || base.username || base.password)
    throw new Error("A secure NyxID web address is required.");
  const url = new URL(
    target.kind === "automations"
      ? "/assistant/automations"
      : target.kind === "skills" ||
          target.kind === "channels" ||
          target.kind === "personal-binding"
        ? "/assistant"
        : target.kind === "bots"
          ? "/channel-bots"
          : target.kind === "templates"
            ? "/onboarding"
            : "/onboarding/setups",
    base.origin,
  );
  if (target.kind === "bots" && target.botId)
    url.pathname = `/channel-bots/${encodeURIComponent(reference.parse(target.botId))}`;
  if (target.kind === "automations") {
    if (target.agentId)
      url.searchParams.set("agent", reference.max(64).parse(target.agentId));
    if (target.automationId)
      url.searchParams.set("automation", z.uuid().parse(target.automationId));
    if (target.setupId)
      url.searchParams.set("setup", z.uuid().parse(target.setupId));
    else if (target.create) url.searchParams.set("create", "true");
  } else if (target.kind === "skills") {
    url.searchParams.set("agent", reference.parse(target.agentId));
    url.searchParams.set("details", "skills");
  } else if (target.kind === "channels" || target.kind === "personal-binding")
    url.searchParams.set("panel", "nyxbot");
  return url.toString();
}
