import type { AssistantAgent } from "../agents/agentContracts";
import type { Automation, AutomationRunsPage } from "./automationContracts";

export function automationTarget(
  row: Automation,
  agents: AssistantAgent[] = [],
) {
  if (row.delivery.type === "assistant") {
    const id = row.delivery.agent_id;
    const agent = agents.find((item) => item.id === id);
    return agent?.display_name || agent?.name || id;
  }
  return row.delivery.type === "notification"
    ? "Reminder"
    : row.delivery.type === "agent"
      ? "Device agent"
      : "HTTPS webhook";
}

export function automationPauseReason(reason: string | null | undefined) {
  switch (reason) {
    case "target_unavailable":
      return "The target agent is unavailable. Review Agent access before resuming.";
    case "assistant_disabled":
      return "NyxBot is disabled. Review your NyxBot settings before resuming.";
    case "owner_unavailable":
      return "The owner account is unavailable.";
    default:
      return reason?.replaceAll("_", " ");
  }
}

export function uniqueAutomationRuns(pages: AutomationRunsPage[]) {
  const seen = new Set<string>();
  return pages
    .flatMap((page) => page.runs)
    .filter((run) => {
      if (seen.has(run.id)) return false;
      seen.add(run.id);
      return true;
    });
}

export function automationScheduleSummary(row: Automation): string {
  const schedule = row.schedule;
  if (!schedule || (row.source ?? "webhook") === "webhook")
    return "Webhook event";
  if (schedule.kind === "cron")
    return `${schedule.expression} · ${schedule.timezone}`;
  if (schedule.kind === "every")
    return `Every ${schedule.amount} ${schedule.unit}`;
  return "One time";
}
