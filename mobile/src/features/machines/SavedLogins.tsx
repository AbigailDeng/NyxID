import { useState } from "react";
import { View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspaceBack } from "../../app/WorkspaceHeader";
import { SegmentControl } from "../../components/SegmentControl";
import { StatusBadge } from "../../components/StatusBadge";
import { SectionBadge } from "../../components/SectionBadge";
import {
  ActionButton,
  Card,
  Label,
  Notice,
  WorkspacePage,
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
import { machineStyles, machineTabs } from "./MachinePresentation";
import { SavedLoginEditor } from "./SavedLoginEditor";
import {
  savedLoginReviewed,
  savedLoginReviewRequired,
} from "./savedLoginEditorTransport";

export function SavedLogins({
  inventory,
  handoffError,
  onWeb,
  onMachines,
}: {
  inventory?: MachineInventory;
  handoffError?: string;
  onWeb: (path: string) => void;
  onMachines: () => void;
}) {
  const write = useMachineWrite();
  const client = useQueryClient();
  const [deleting, setDeleting] = useState<SavedLogin>();
  const [notice, setNotice] = useState<string>();
  const [refreshError, setRefreshError] = useState<string>();
  const [editing, setEditing] = useState<SavedLogin | "new">();
  const [needsReview, setNeedsReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = write.busy || saving;
  const reviewRequired =
    needsReview ||
    (!!inventory?.userId && savedLoginReviewRequired(inventory.userId));
  const logins = useQuery({
    queryKey: [...machineKeys(write.epoch), "logins"],
    queryFn: ({ signal }) => machinesApi.logins(signal),
    enabled: write.active,
    retry: false,
  });
  useWorkspaceBack({
    active: !!deleting || !!editing || busy,
    disabled: busy,
    onBack: () => {
      setDeleting(undefined);
      setEditing(undefined);
    },
    discardOnClose:
      deleting || editing
        ? {
            title: "Close saved-login review?",
            message: editing
              ? "Unsaved credentials will be cleared."
              : "The login will not be deleted.",
          }
        : undefined,
  });
  const ownerLabel = (login: SavedLogin) =>
    login.owner_id === inventory?.userId
      ? "Your personal account"
      : (inventory?.nodes.find((node) => node.owner.id === login.owner_id)
          ?.owner.display_name ?? `Organization ${login.owner_id}`);
  const blocked =
    busy ||
    write.uncertain ||
    reviewRequired ||
    !write.active ||
    !!logins.error;
  async function refresh() {
    const result = await logins.refetch();
    if (!write.current()) return;
    if (!result.isSuccess || result.error)
      setRefreshError(
        result.error
          ? machineError(result.error)
          : "Saved-login metadata could not be verified. Refresh again before editing.",
      );
    else {
      write.reviewed();
      setDeleting(undefined);
      setRefreshError(undefined);
      setNeedsReview(false);
      if (inventory?.userId) savedLoginReviewed(inventory.userId);
    }
  }
  return (
    <WorkspacePage
      title="Saved logins"
      showHeading={false}
      refreshing={logins.isRefetching}
      onRefresh={() => {
        if (!busy && write.active) void refresh();
      }}
    >
      <SegmentControl
        segments={machineTabs}
        activeIndex={1}
        disabled={busy}
        onPress={(index) => {
          if (index === 0) confirmDiscard(!!deleting || !!editing, onMachines);
        }}
      />
      <Label muted style={machineStyles.metadata}>
        Metadata only. Passwords and TOTP secrets are never returned or stored
        by this screen. Create or fully replace credentials using the secure
        form.
      </Label>
      {handoffError && <Notice tone="error" message={handoffError} />}
      {logins.isPending && <Label muted>Loading saved logins…</Label>}
      {logins.error && (
        <Notice tone="error" message={machineError(logins.error)} />
      )}
      {write.error && <Notice tone="error" message={write.error} />}
      {refreshError && <Notice tone="error" message={refreshError} />}
      {notice && <Notice message={notice} />}
      {reviewRequired && (
        <Notice message="A save may have reached the server. Refresh and review the metadata before editing again." />
      )}
      {editing && inventory?.userId ? (
        <SavedLoginEditor
          key={editing === "new" ? "new" : editing.id}
          userId={inventory.userId}
          login={editing === "new" ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onUncertain={() => setNeedsReview(true)}
          onBusy={setSaving}
          onSaved={() => {
            setNotice(
              "Saved login updated. Credentials are not returned by the server.",
            );
            void client.invalidateQueries({
              queryKey: machineKeys(write.epoch),
            });
            void client.invalidateQueries({
              queryKey: ["workspace", "agents"],
            });
          }}
        />
      ) : deleting ? (
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
            <View style={machineStyles.row}>
              <Label numberOfLines={1} style={machineStyles.name}>
                {login.label}
              </Label>
              <StatusBadge label="Saved login" variant="orgChip" />
            </View>
            <Label muted style={machineStyles.metadata}>
              {ownerLabel(login)}
              {login.username_hint ? ` · ${login.username_hint}` : ""}
            </Label>
            <Label muted style={machineStyles.metadata}>
              {login.allowed_origins.join(", ")}
            </Label>
            <View style={machineStyles.badges}>
              <StatusBadge
                label={login.has_password ? "Password stored" : "No password"}
                variant={
                  login.has_password ? "decisionApproved" : "decisionExpired"
                }
              />
              {login.has_totp ? (
                <SectionBadge label="TOTP stored" tone="success" />
              ) : (
                <StatusBadge
                  label="No authenticator"
                  variant="decisionExpired"
                />
              )}
            </View>
            <Label muted style={machineStyles.metadata}>
              {login.confirm_each_sign_in
                ? "Confirms every sign-in"
                : "Uses machine confirmation"}
            </Label>
            <ActionButton
              compact
              label="Replace credentials"
              accessibilityLabel={`Replace credentials for ${login.label}`}
              variant="secondary"
              disabled={blocked || !inventory?.userId}
              onPress={() => setEditing(login)}
            />
            <ActionButton
              compact
              label="Review deletion"
              accessibilityLabel={`Review deletion of ${login.label}`}
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
        compact
        label="Add saved login"
        disabled={blocked || !inventory?.userId || !!editing}
        onPress={() => setEditing("new")}
      />
      <ActionButton
        compact
        label="Refresh saved login metadata"
        variant="secondary"
        disabled={busy || !write.active || !!editing}
        onPress={() => void refresh()}
      />
      <ActionButton
        compact
        label="Saved logins on web"
        variant="secondary"
        disabled={busy}
        onPress={() => onWeb(machineWebPath(undefined, "logins"))}
      />
    </WorkspacePage>
  );
}
