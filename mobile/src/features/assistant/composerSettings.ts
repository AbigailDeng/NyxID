import { z } from "zod";
import { accessModeSchema } from "../agents/agentContracts";
import type { AssistantModel } from "./assistantTypes";

export type ComposerAccessMode = z.infer<typeof accessModeSchema>;
export const composerSettingsSchema = z.object({
  access_mode: accessModeSchema.default("nyxmode"),
});
export const COMPOSER_ACCESS_LABEL = {
  autopilot: "Full access",
  nyxmode: "Auto",
  ask_every_time: "Ask every time",
} as const satisfies Record<ComposerAccessMode, string>;

/** Same labels and unavailable-current-model fallback as the web composer. */
export function composerModelName(model: Pick<AssistantModel, "id" | "label">) {
  const alias = model.id.replace(/^nyxagent\//, "");
  const label = model.label.trim();
  if (label && label !== alias && label !== model.id) return label;
  if (model.id === "nyxagent/chat") return "Default model";
  return alias
    .replace(/[_-]+/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}
export function composerModelOptions(
  models: readonly AssistantModel[] | undefined,
  current: string,
) {
  const rows = [...(models ?? [])];
  if (!rows.some((row) => row.id === current))
    rows.unshift({
      id: current,
      label: current.replace(/^nyxagent\//, ""),
      available: false,
    });
  return rows;
}
