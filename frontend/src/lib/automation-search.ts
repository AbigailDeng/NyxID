export interface AutomationSearch {
  readonly setup?: string;
  readonly agent?: string;
  readonly automation?: string;
  readonly create?: boolean;
}

export function parseAutomationSearch(
  search: Record<string, unknown>,
): AutomationSearch {
  return {
    ...(typeof search.automation === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      search.automation,
    )
      ? { automation: search.automation }
      : {}),
    ...(search.create === true || search.create === "true"
      ? { create: true }
      : {}),
    ...(typeof search.setup === "string" &&
    /^[0-9a-f-]{36}$/i.test(search.setup)
      ? { setup: search.setup }
      : {}),
    ...(typeof search.agent === "string" &&
    search.agent.length <= 64 &&
    search.agent
      ? { agent: search.agent }
      : {}),
  };
}
