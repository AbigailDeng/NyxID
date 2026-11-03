import type { ServiceConnection } from "../serviceContracts";
import type { ConsoleIdentity, ConsoleOrganization } from "./consoleTransport";

export type ConsoleDestination = {
  label: string;
  description: string;
  path: string;
};
export function consoleDestinations(
  user: ConsoleIdentity,
  orgs: ConsoleOrganization[],
): ConsoleDestination[] {
  const role =
    user.role ??
    (user.is_admin ? "admin" : user.is_operator ? "operator" : "user");
  const admin = role === "admin";
  const operator = admin || role === "operator";
  return [
    {
      label: "Agent Keys",
      description:
        "Rename, scopes, rotation, grants, limits and usage. Login key selection remains in the app.",
      path: "/keys?tab=nyxid",
    },
    {
      label: "Service Pools",
      description: "Routing strategy, weights, retries and pool health.",
      path: "/keys?tab=pools",
    },
    {
      label: "Tools directory",
      description:
        "Find tools and inspect operations, risk, prices and limits.",
      path: "/tools",
    },
    {
      label: "Credential Nodes",
      description:
        "Registration, ownership, credentials, queues and metrics. Machine desktops remain in Machines.",
      path: "/nodes",
    },
    {
      label: "Developer OAuth Apps",
      description: "Clients, redirect URIs, scopes and client secrets.",
      path: "/developer/apps",
    },
    {
      label: "Organization or custom connection",
      description: "Choose ownership and advanced service types in Web.",
      path: "/keys?tab=services&action=add-service",
    },
    ...orgs
      .filter((org) => ["owner", "admin"].includes(org.your_role))
      .flatMap((org) => [
        {
          label: `${org.display_name || org.slug || org.id} · Service Accounts`,
          description: "Organization admins manage service identities in Web.",
          path: `/orgs/${encodeURIComponent(org.id)}?tab=service-accounts`,
        },
        {
          label: `${org.display_name || org.slug || org.id} · Developer Apps`,
          description: "Organization OAuth applications and credentials.",
          path: `/orgs/${encodeURIComponent(org.id)}?tab=developer-apps`,
        },
      ]),
    ...(admin || user.capabilities?.manage_catalog === true
      ? [
          {
            label: "Catalog authoring",
            description:
              "Author catalog services with your granted Catalog Manager access.",
            path: "/services",
          },
          {
            label: "Providers",
            description: "OAuth provider configuration remains in Web.",
            path: "/providers",
          },
        ]
      : []),
    ...(admin || user.capabilities?.manage_tools === true
      ? [
          {
            label: "Tools Manager",
            description:
              "Manage tools with your granted Tools Manager access; publishing remains admin controlled.",
            path: "/admin/tools",
          },
        ]
      : []),
    ...(operator
      ? [
          {
            label: "Admin console",
            description: admin
              ? "Users, roles, groups, ownership, audit, billing, integrity and platform configuration."
              : "Read platform administration; Web enforces read-only Operator access.",
            path: "/admin/users",
          },
        ]
      : []),
    ...(operator || user.capabilities?.read_admin_usage === true
      ? [
          {
            label: "Admin usage",
            description: "Usage analytics with your granted read access.",
            path: "/admin/usage",
          },
        ]
      : []),
    ...(operator || user.capabilities?.read_feature_flags === true
      ? [
          {
            label: "Feature flags",
            description:
              "Review flags; Web applies your individual read/write permissions.",
            path: "/admin/feature-flags",
          },
        ]
      : []),
    {
      label: "Dashboard",
      description: "Console metrics and first proxy onboarding.",
      path: "/dashboard",
    },
    {
      label: "Integration documentation",
      description: "MCP, CLI, SDK and service integration guides.",
      path: "/docs",
    },
    {
      label: "Blog",
      description: "Product updates and articles.",
      path: "/blog",
    },
  ];
}

export function advancedConnectionDestinations(
  connection: ServiceConnection,
  editable: boolean,
): ConsoleDestination[] {
  const platform =
    connection.auto_connected || connection.credential_binding === "platform";
  const ssh = connection.service_type === "ssh";
  const path = `/keys/${encodeURIComponent(connection.id)}?tab=${platform ? "overview" : "advanced"}`;
  const canSsh =
    ssh &&
    connection.catalog_service_id &&
    Boolean(connection.ssh_ca_public_key) &&
    connection.is_active &&
    (connection.credential_source?.type !== "org" ||
      (connection.credential_source.allowed &&
        connection.credential_source.role !== "viewer"));
  return [
    ...(platform
      ? ["Platform connection details"]
      : ssh
        ? [
            "SSH configuration",
            "Routing and credential Node",
            "Ownership and permissions",
          ]
        : [
            "Endpoint and OpenAPI",
            "Routing and credential Node",
            "Headers and User-Agent",
            "WebSocket injection",
            "Service skills",
            "Ownership and permissions",
          ]
    ).map((label) => ({
      label,
      description:
        editable && !platform
          ? "Configure this connection in Web."
          : "Review this connection in Web. Your current role cannot edit its configuration.",
      path,
    })),
    ...(canSsh
      ? [
          {
            label: "SSH terminal",
            description:
              "Open this SSH service in Web. Terminal in the app creates CLI login codes; it is not an SSH terminal.",
            path: `/ssh/${encodeURIComponent(connection.catalog_service_id!)}/terminal?returnKeyId=${encodeURIComponent(connection.id)}`,
          },
        ]
      : []),
  ];
}

/** Paths are generated locally, never supplied by downstream services. */
export function consoleWebUrl(origin: string, path: string): string {
  const base = new URL(origin);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    !path.startsWith("/") ||
    path.startsWith("//")
  )
    throw new Error("NyxID Web address is unavailable.");
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new Error("Invalid Web destination.");
  return url.href;
}
