import type { ServiceConnection } from "../serviceContracts";

export type ConsoleDestination = {
  label: string;
  description: string;
  path: string;
};

/**
 * Advanced settings are one contextual handoff per connection. Individual
 * Web tabs are an implementation detail of the page and do not need separate
 * native buttons. SSH terminal remains the one distinct action because it
 * starts a different task from connection administration.
 */
export function advancedConnectionDestinations(
  connection: ServiceConnection,
  editable: boolean,
): ConsoleDestination[] {
  const platform =
    connection.auto_connected || connection.credential_binding === "platform";
  const ssh = connection.service_type === "ssh";
  const advancedPath = `/keys/${encodeURIComponent(connection.id)}?tab=${platform ? "overview" : "advanced"}`;
  const canSsh =
    ssh &&
    connection.catalog_service_id &&
    Boolean(connection.ssh_ca_public_key) &&
    connection.is_active &&
    (connection.credential_source?.type !== "org" ||
      (connection.credential_source.allowed &&
        connection.credential_source.role !== "viewer"));
  const links: ConsoleDestination[] = [
    {
      label: platform
        ? "View connection details · Web"
        : editable
          ? "Edit advanced settings · Web"
          : "View advanced settings · Web",
      description:
        editable && !platform
          ? "Configure this connection in Web."
          : "Review this connection in Web. Your current role cannot edit its configuration.",
      path: advancedPath,
    },
  ];
  if (canSsh) {
    links.push({
      label: "SSH terminal · Web",
      description:
        "Open this SSH service in Web. Terminal in the app creates CLI login codes; it is not an SSH terminal.",
      path: `/ssh/${encodeURIComponent(connection.catalog_service_id!)}/terminal?returnKeyId=${encodeURIComponent(connection.id)}`,
    });
  }
  return links;
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
