import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspaceBack } from "../../app/WorkspaceHeader";
import {
  ActionButton,
  Card,
  Label,
  Notice,
} from "../../components/workspace/WorkspaceUI";
import { machinesApi } from "../../lib/api/machinesApi";
import {
  machineWebPath,
  type MachineInventory,
  type SavedLogin,
} from "./machineContracts";
import {
  confirmDiscard,
  machineError,
  machineKeys,
  useMachineWrite,
} from "./MachineUI";

export function SavedLogins({
  inventory,
  onWeb,
  onMachines,
}: {
  inventory?: MachineInventory;
  onWeb: (path: string) => void;
  onMachines: () => void;
}) {
  const write = useMachineWrite();
  const client = useQueryClient();
  const [deleting, setDeleting] = useState<SavedLogin>();
  const [notice, setNotice] = useState<string>();
  const [refreshError, setRefreshError] = useState<string>();
  const logins = useQuery({
    queryKey: [...machineKeys(write.epoch), "logins"],
    queryFn: ({ signal }) => machinesApi.logins(signal),
    enabled: write.active,
    retry: false,
  });
  useWorkspaceBack({
    active: !!deleting || write.busy,
    disabled: write.busy,
    onBack: () => setDeleting(undefined),
    discardOnClose: deleting
      ? {
          title: "Close saved-login review?",
          message: "The login will not be deleted.",
        }
      : undefined,
  });
  const ownerLabel = (login: SavedLogin) =>
    login.owner_id === inventory?.userId
      ? "Your personal account"
      : (inventory?.nodes.find((node) => node.owner.id === login.owner_id)
          ?.owner.display_name ?? `Organization ${login.owner_id}`);
  const blocked =
    write.busy || write.uncertain || !write.active || !!logins.error;
  async function refresh() {
    const result = await logins.refetch();
    if (!write.current()) return;
    if (result.error) setRefreshError(machineError(result.error));
    else {
      write.reviewed();
      setDeleting(undefined);
      setRefreshError(undefined);
    }
  }
  return (
    <>
      <ActionButton
        label="Show machines"
        variant="secondary"
        disabled={write.busy}
        onPress={() => confirmDiscard(!!deleting, onMachines)}
      />
      <Label>Saved logins</Label>
      <Label muted>
        Metadata only. Passwords and TOTP secrets are never returned or stored
        by this screen. Create or edit logins on the web.
      </Label>
      {logins.isPending && <Label muted>Loading saved logins…</Label>}
      {logins.error && (
        <Notice tone="error" message={machineError(logins.error)} />
      )}
      {write.error && <Notice tone="error" message={write.error} />}
      {refreshError && <Notice tone="error" message={refreshError} />}
      {notice && <Notice message={notice} />}
      <ActionButton
        label="Refresh saved logins"
        variant="secondary"
        disabled={write.busy || !write.active || logins.isFetching}
        onPress={() => void refresh()}
      />
      {deleting ? (
        <Card>
          <Label>
            Delete {deleting.label} from {ownerLabel(deleting)}?
          </Label>
          <Notice message="This permanently removes the saved login, quarantines its login contexts, and removes specialist login grants. Existing external sign-ins may remain active. This cannot be undone." />
          <ActionButton
            label={`Permanently delete ${deleting.label}`}
            variant="danger"
            disabled={blocked}
            loading={write.busy}
            onPress={() =>
              void write.run(async (current) => {
                await machinesApi.removeLogin(deleting, current);
                if (!current()) return;
                setDeleting(undefined);
                setNotice(
                  "Saved login deleted. Its login contexts are quarantined and specialist grants have been removed.",
                );
                await Promise.all([
                  client.invalidateQueries({
                    queryKey: machineKeys(write.epoch),
                  }),
                  client.invalidateQueries({
                    queryKey: ["workspace", "agents"],
                  }),
                ]);
              })
            }
          />
          <ActionButton
            label="Keep saved login"
            variant="secondary"
            disabled={write.busy}
            onPress={() => setDeleting(undefined)}
          />
        </Card>
      ) : (
        logins.data?.map((login) => (
          <Card key={login.id}>
            <Label>{login.label}</Label>
            <Label muted>{ownerLabel(login)}</Label>
            <Label muted>{login.allowed_origins.join(", ")}</Label>
            {login.username_hint && <Label muted>{login.username_hint}</Label>}
            <Label muted>
              Password: {login.has_password ? "Stored" : "None"} · TOTP:{" "}
              {login.has_totp ? "Stored" : "None"} ·{" "}
              {login.confirm_each_sign_in
                ? "Confirms every sign-in"
                : "Uses machine confirmation"}
            </Label>
            <ActionButton
              label={`Review deletion of ${login.label}`}
              variant="danger"
              disabled={blocked}
              onPress={() => setDeleting(login)}
            />
          </Card>
        ))
      )}
      {!logins.isPending && !logins.error && !logins.data?.length && (
        <Label muted>No saved logins available.</Label>
      )}
      <ActionButton
        label="Create or edit saved logins on web"
        variant="secondary"
        disabled={write.busy}
        onPress={() => onWeb(machineWebPath(undefined, "logins"))}
      />
    </>
  );
}
