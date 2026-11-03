import { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SheetScreenProps } from "../../app/navigationTypes";
import { useWorkspaceBack } from "../../app/WorkspaceHeader";
import {
  ActionButton,
  Card,
  Field,
  Label,
  Notice,
  WorkspacePage,
} from "../../components/workspace/WorkspaceUI";
import { assistantManagementApi as api } from "../../lib/api/assistantManagementApi";
import { agentsApi } from "../../lib/api/agentsApi";
import { getAuthEpoch } from "../../lib/auth/authEpoch";
import {
  ChoiceField,
  automationError,
  automationStyles as s,
  useAutomationRuntime,
} from "../automations/AutomationUI";
import { deviceTimezone } from "../automations/automationTime";
import { ManagementHandoff } from "./ManagementHandoff";
import {
  settingFields,
  settingsForm,
  settingsPatch,
  type AssistantSettings,
  type SettingField,
  type SettingsForm,
} from "./managementContracts";

const ROOT = ["workspace", "assistant-management"] as const;
const labels: Record<SettingField, string> = {
  max_auto_continuations: "Automatic task continuations",
  max_live_subagents: "Live specialists",
  max_concurrent_subagent_turns: "Specialists working at once",
  max_group_handoffs: "Group handoffs per message",
  max_group_handoffs_per_hour: "Group handoffs per hour",
  schedule_minimum_minutes: "Minimum schedule interval (minutes)",
  trigger_runs_per_hour: "Automation runs per hour",
  trigger_runs_per_day: "Automation runs per day",
};
function ranges(settings: AssistantSettings): Record<SettingField, string> {
  return {
    max_auto_continuations: `0–${Math.min(32, settings.max_auto_continuations_limit)}; 0 turns continuation off`,
    max_live_subagents: `0–${settings.max_live_subagents_limit}`,
    max_concurrent_subagent_turns: `1–${settings.max_concurrent_subagent_turns_limit}`,
    max_group_handoffs: `0–${settings.max_group_handoffs_limit}; 0 turns handoffs off`,
    max_group_handoffs_per_hour: `0–${settings.max_group_handoffs_per_hour_limit}`,
    schedule_minimum_minutes: "5–1440",
    trigger_runs_per_hour: "1–300",
    trigger_runs_per_day: "1–3000",
  };
}

export function AssistantManagementScreen({
  navigation,
}: SheetScreenProps<"AssistantManagement">) {
  const runtime = useAutomationRuntime();
  const client = useQueryClient();
  const epoch = useRef(getAuthEpoch()).current;
  const authority = useRef(runtime);
  authority.current = runtime;
  const query = useQuery({
    queryKey: [...ROOT, "settings", epoch],
    queryFn: ({ signal }) => api.settings(signal),
    enabled: runtime.active,
    retry: false,
  });
  const channels = useQuery({
    queryKey: [...ROOT, "channels", epoch],
    queryFn: ({ signal }) => api.channels(signal),
    enabled: runtime.active,
    retry: false,
  });
  const agents = useQuery({
    queryKey: ["workspace", "agents", "list"],
    queryFn: ({ signal }) => agentsApi.list(signal),
    enabled: runtime.active,
    retry: false,
  });
  const [baseline, setBaseline] = useState<SettingsForm>();
  const [form, setForm] = useState<SettingsForm>();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const dirty = Boolean(
    form && baseline && JSON.stringify(form) !== JSON.stringify(baseline),
  );
  function accept(settings: AssistantSettings) {
    const value = settingsForm(settings, deviceTimezone());
    setBaseline(value);
    setForm(value);
    setUncertain(false);
  }
  useEffect(() => {
    if (query.data && !dirty && !busy) accept(query.data);
  }, [query.data]);
  useWorkspaceBack({
    active: false,
    onBack: () => navigation.goBack(),
    defaultRole: "back",
    disabled: busy,
    discardOnClose: dirty
      ? {
          title: "Discard NyxBot changes?",
          message:
            "Your unsaved limits and automation preferences will be lost.",
        }
      : undefined,
  });
  let invalid: string | undefined;
  if (form && baseline && query.data) {
    try {
      settingsPatch(form, baseline, query.data);
    } catch (cause) {
      invalid = automationError(cause);
    }
  }
  const blocked =
    busy ||
    !runtime.active ||
    !runtime.online ||
    query.isError ||
    query.isFetching ||
    uncertain;
  async function reload() {
    if (lock.current) return;
    const result = await query.refetch();
    await channels.refetch();
    if (getAuthEpoch() !== epoch) return;
    if (result.data && !result.isError) {
      accept(result.data);
      setError(undefined);
      setNotice("Current settings loaded.");
    }
  }
  function requestReload() {
    if (dirty)
      Alert.alert(
        "Discard unsaved changes?",
        "Reload the current settings from NyxID.",
        [
          { text: "Keep editing", style: "cancel" },
          {
            text: "Reload",
            style: "destructive",
            onPress: () => void reload(),
          },
        ],
      );
    else void reload();
  }
  function guard() {
    if (
      getAuthEpoch() !== epoch ||
      !authority.current.active ||
      !authority.current.online
    )
      throw new Error(
        "Your session or page changed. Reopen NyxBot settings before saving.",
      );
  }
  async function save() {
    if (
      lock.current ||
      blocked ||
      !form ||
      !baseline ||
      !query.data ||
      !dirty ||
      invalid
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    let sent = false;
    try {
      guard();
      const latest = await api.settings();
      guard();
      const patch = settingsPatch(form, baseline, latest);
      const latestForm = settingsForm(latest, deviceTimezone());
      if (
        Object.keys(patch).some(
          (field) =>
            latestForm[field as keyof SettingsForm] !==
            baseline[field as keyof SettingsForm],
        )
      )
        throw new Error(
          "These settings changed elsewhere. Reload and review before saving.",
        );
      sent = true;
      const saved = await api.update(patch, guard);
      guard();
      accept(saved);
      client.setQueryData([...ROOT, "settings", epoch], saved);
      await client.invalidateQueries({
        queryKey: ["workspace", "automations", "settings"],
      });
      setNotice("NyxBot settings saved.");
    } catch (cause) {
      if (getAuthEpoch() === epoch) {
        setError(
          `${automationError(cause)}${sent ? " The result is unconfirmed. Reload settings before trying again." : ""}`,
        );
        if (sent) setUncertain(true);
      }
    } finally {
      lock.current = false;
      if (getAuthEpoch() === epoch) setBusy(false);
    }
  }
  return (
    <WorkspacePage
      title="NyxBot management"
      showHeading={false}
      refreshing={query.isFetching}
      onRefresh={requestReload}
    >
      <Label style={s.section}>NyxBot limits & automation preferences</Label>
      <Label muted>
        Higher limits can spend credits faster. Stop in chat ends the current
        task. Access mode stays in the chat composer.
      </Label>
      {!runtime.online && (
        <Notice message="You’re offline. Reconnect to read and save settings." />
      )}
      {query.isPending && <Label muted>Loading current limits…</Label>}
      {query.error && (
        <Notice tone="error" message={automationError(query.error)} />
      )}
      {error && <Notice tone="error" message={error} />}
      {notice && <Notice tone="success" message={notice} />}
      {query.data && form && (
        <>
          <Card>
            {settingFields.map((field) => (
              <View key={field} style={{ gap: 4 }}>
                <Field
                  label={labels[field]}
                  value={form[field]}
                  keyboardType="number-pad"
                  editable={!blocked}
                  onChangeText={(value) => setForm({ ...form, [field]: value })}
                />
                <Label muted style={s.small}>
                  {ranges(query.data)[field]}
                </Label>
              </View>
            ))}
            <Field
              label="Automation timezone"
              value={form.timezone}
              autoCapitalize="none"
              placeholder="Asia/Shanghai"
              editable={!blocked}
              onChangeText={(timezone) => setForm({ ...form, timezone })}
            />
            <Label muted style={s.small}>
              IANA timezone; affects new automation defaults.
            </Label>
            <ChoiceField
              label="Specialist requests for more access"
              value={form.specialist_access_requests}
              disabled={blocked}
              onChange={(specialist_access_requests) =>
                setForm({ ...form, specialist_access_requests })
              }
              options={[
                { value: "denied", label: "Deny requests" },
                {
                  value: "routed_to_nyxbot",
                  label: "Route requests to NyxBot",
                },
              ]}
            />
            {invalid && <Notice tone="error" message={invalid} />}
            <ActionButton
              label="Save settings"
              disabled={blocked || !dirty || Boolean(invalid)}
              loading={busy}
              onPress={() => void save()}
            />
          </Card>
        </>
      )}
      <ActionButton
        label="Reload current settings"
        variant="secondary"
        disabled={busy || !runtime.active || !runtime.online}
        onPress={requestReload}
      />
      <Card>
        <Label style={s.title}>Channels & bots</Label>
        <Label muted>
          Connect credentials, verify ownership, choose the receiving agent,
          reconnect or disconnect on NyxID web. Your channel chats stay
          available in the App.
        </Label>
        {channels.isPending && <Label muted>Loading channel readiness…</Label>}
        {channels.error && (
          <Notice tone="error" message={automationError(channels.error)} />
        )}
        {channels.data?.length === 0 && !channels.isError && (
          <Label muted>No connected channels for this account.</Label>
        )}
        {channels.data?.map((channel) => (
          <View key={channel.id} style={{ gap: 4 }}>
            <Label>
              {channel.bot_label} · {channel.platform} · {channel.status}
            </Label>
            <Label muted style={s.small}>
              {channel.org_id ? "Organization bot" : "Personal bot"} ·{" "}
              {channel.owner_linked
                ? "Owner verified"
                : "Owner verification needed"}
            </Label>
            <Label muted style={s.small}>
              Receiving agent:{" "}
              {channel.agent_id
                ? agents.data?.agents.find(
                    (agent) => agent.id === channel.agent_id,
                  )?.display_name ||
                  agents.data?.agents.find(
                    (agent) => agent.id === channel.agent_id,
                  )?.name ||
                  "Unavailable; review on web"
                : "NyxBot"}
            </Label>
            {channel.delivery_status && (
              <Label muted style={s.small}>
                Latest delivery: {channel.delivery_status}
              </Label>
            )}
            {(channel.last_error || channel.delivery_reason) && (
              <Notice
                message={channel.delivery_reason || channel.last_error!}
              />
            )}
            <ManagementHandoff
              label={`Manage ${channel.bot_label} on web`}
              target={{ kind: "bots", botId: channel.channel_bot_id }}
              disabled={busy || dirty}
            />
          </View>
        ))}
        <ManagementHandoff
          label="Manage channel connections on web"
          target={{ kind: "channels" }}
          disabled={busy || dirty}
        />
        <ManagementHandoff
          label="Connect or manage bots on web"
          target={{ kind: "bots" }}
          disabled={busy || dirty}
        />
      </Card>
      <Card>
        <Label style={s.title}>Bot onboarding</Label>
        <Label muted>
          Web handles templates, personal bindings, setup progress and
          revocation. Sign in there with this same NyxID account.
        </Label>
        <ManagementHandoff
          label="Start bot onboarding on web"
          target={{ kind: "templates" }}
          disabled={busy || dirty}
        />
        <ManagementHandoff
          label="Manage onboarding setups on web"
          target={{ kind: "setups" }}
          disabled={busy || dirty}
        />
        <ManagementHandoff
          label="Manage personal chat links on web"
          target={{ kind: "personal-binding" }}
          disabled={busy || dirty}
        />
      </Card>
    </WorkspacePage>
  );
}
