export type AutomationLinkParams = {
  agentId?: string;
  setupId?: string;
  automationId?: string;
  create?: boolean;
};

export type AutomationLink =
  | { kind: "automation"; params: AutomationLinkParams }
  | { kind: "invalid"; message: string };

const setupId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Model text may link into native Automations only on the configured frontend. */
export function parseAutomationLink(
  value: string,
  frontendUrl: string,
): AutomationLink | null {
  try {
    const frontend = new URL(frontendUrl);
    const link = new URL(value);
    if (
      frontend.protocol !== "https:" ||
      frontend.username ||
      frontend.password ||
      link.protocol !== "https:" ||
      link.username ||
      link.password ||
      link.origin !== frontend.origin ||
      !["/assistant/automations", "/automations"].includes(link.pathname)
    )
      return null;

    const params: AutomationLinkParams = {};
    const setup = link.searchParams.getAll("setup");
    const agent = link.searchParams.getAll("agent");
    const automation = link.searchParams.getAll("automation");
    const create = link.searchParams.getAll("create");
    if (setup.length > 1 || (setup.length && !setupId.test(setup[0]!)))
      return {
        kind: "invalid",
        message:
          "This automation setup link is invalid. Ask NyxBot for a new link.",
      };
    if (
      agent.length > 1 ||
      (agent.length &&
        (!agent[0]!.trim() ||
          agent[0]!.length > 64 ||
          /[\u0000-\u001f\u007f]/.test(agent[0]!)))
    )
      return {
        kind: "invalid",
        message:
          "This automation link has an invalid agent. Ask NyxBot for a new link.",
      };
    if (agent.length) params.agentId = agent[0]!;
    if (
      automation.length > 1 ||
      (automation.length && !setupId.test(automation[0]!)) ||
      create.length > 1 ||
      (create.length && create[0] !== "true")
    )
      return {
        kind: "invalid",
        message:
          "This automation management link is invalid. Ask NyxBot for a new link.",
      };
    if (setup.length) params.setupId = setup[0]!;
    if (automation.length) params.automationId = automation[0]!;
    if (create.length) params.create = true;
    // Only bounded identifiers cross. Authoring stays on web; preserve its
    // setup context without copying instructions, credentials or return URLs.
    return { kind: "automation", params };
  } catch {
    return null;
  }
}
