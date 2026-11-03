import { useEffect, useRef, useState } from "react";
import {
  ActionButton,
  Card,
  Field,
  Label,
  Notice,
} from "../../components/workspace/WorkspaceUI";
import { pluginSkillsApi as api } from "../../lib/api/pluginSkillsApi";
import { agentsApi } from "../../lib/api/agentsApi";
import { getAuthEpoch } from "../../lib/auth/authEpoch";
import { useManagementWriteScope } from "../assistant-management/useManagementWriteScope";
import {
  automationError,
  automationStyles as s,
  useAutomationRuntime,
} from "../automations/AutomationUI";
import {
  assertSkillRevision,
  skillEnabledSelection,
  skillPreloadPaths,
  type AgentSkill,
  type AgentSkills,
} from "./pluginSkillsTypes";

export function SkillActivationControls({
  agentId,
  pin,
  current,
  disabled,
  onRefresh,
  onBusy,
  onDirty,
}: {
  agentId: string;
  pin: AgentSkill;
  current: AgentSkills;
  disabled: boolean;
  onRefresh: () => Promise<void>;
  onBusy: (value: boolean) => void;
  onDirty: (value: boolean) => void;
}) {
  const runtime = useAutomationRuntime();
  const writeScope = useManagementWriteScope(runtime.active);
  const authority = useRef(runtime);
  authority.current = runtime;
  const epoch = useRef(getAuthEpoch()).current;
  const initial = (current.metadata[pin.skill_id]?.preload_paths ?? []).join(
    "\n",
  );
  const [paths, setPaths] = useState(initial);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const dirty = paths !== initial;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  let invalid: string | undefined;
  try {
    skillPreloadPaths(paths);
  } catch (cause) {
    invalid = automationError(cause);
  }
  const blocked =
    disabled || busy || uncertain || !runtime.active || !runtime.online;
  function guard() {
    if (
      epoch !== getAuthEpoch() ||
      !authority.current.active ||
      !authority.current.online
    )
      throw new Error(
        "Your session or page changed. Reopen this skill before saving.",
      );
  }
  async function save(mode: "enabled" | "preload") {
    if (blocked || lock.current || (mode === "preload" && invalid)) return;
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setError(undefined);
    setNotice(undefined);
    let sent = false;
    const assertScope = writeScope.capture();
    const writeGuard = () => {
      assertScope();
      guard();
    };
    try {
      writeGuard();
      const [latest, agent] = await Promise.all([
        api.current(agentId),
        agentsApi.detail(agentId),
      ]);
      writeGuard();
      if (
        agent.agent.can_maintain === false ||
        agent.agent.status === "destroyed"
      )
        throw new Error("Your maintenance access changed. Reload this agent.");
      assertSkillRevision(agentId, current, latest);
      const attached = latest.skills.find(
        (item) => item.skill_id === pin.skill_id,
      );
      if (!attached)
        throw new Error(
          "This skill is no longer attached. Reload the current skills.",
        );
      if (mode === "preload") {
        if (attached.disabled)
          throw new Error("Enable this skill before changing its preload.");
        const selected = skillPreloadPaths(paths);
        sent = true;
        await api.preload(
          agentId,
          pin.skill_id,
          { expected_revision: latest.revision, paths: selected },
          writeGuard,
        );
      } else {
        sent = true;
        await api.write(
          agentId,
          skillEnabledSelection(
            latest,
            pin.skill_id,
            Boolean(attached.disabled),
          ),
          writeGuard,
        );
      }
      writeGuard();
      await onRefresh();
      writeGuard();
      setNotice(
        mode === "enabled" ? "Skill activation saved." : "Skill preload saved.",
      );
    } catch (cause) {
      if (writeScope.isMounted() && epoch === getAuthEpoch()) {
        setError(
          `${automationError(cause)}${sent ? " The result is unconfirmed. Reload before trying again." : ""}`,
        );
        if (sent) setUncertain(true);
      }
    } finally {
      lock.current = false;
      if (writeScope.isMounted()) {
        onBusy(false);
        if (epoch === getAuthEpoch()) setBusy(false);
      }
    }
  }
  return (
    <Card>
      <Label style={s.title}>Activation & preload</Label>
      <Label muted>
        {pin.disabled
          ? "Disabled: this agent does not read this skill."
          : "Enabled: this exact skill version is available to this agent."}
      </Label>
      <ActionButton
        label={pin.disabled ? "Enable skill" : "Disable skill"}
        variant="secondary"
        disabled={blocked || dirty}
        loading={busy}
        onPress={() => void save("enabled")}
      />
      <Field
        label="Preload file paths"
        value={paths}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={"SKILL.md\nreferences/example.md"}
        editable={!blocked && !pin.disabled}
        onChangeText={setPaths}
      />
      <Label muted style={s.small}>
        One .md or .txt path per line, up to 8. Include SKILL.md. Clear all
        paths to turn preload off. NyxID checks that files exist and limits all
        preloaded content for the agent to 64 KiB. Guest chats do not receive
        preload; loaded content uses context. Changing the version resets
        preload.
      </Label>
      <Label muted style={s.small}>
        Current preload:{" "}
        {(current.metadata[pin.skill_id]?.preload_bytes ?? 0).toLocaleString()}{" "}
        bytes
      </Label>
      {invalid && dirty && <Notice tone="error" message={invalid} />}
      {error && <Notice tone="error" message={error} />}
      {notice && <Notice tone="success" message={notice} />}
      <ActionButton
        label="Save preload"
        disabled={
          blocked || Boolean(pin.disabled) || !dirty || Boolean(invalid)
        }
        loading={busy}
        onPress={() => void save("preload")}
      />
      <ActionButton
        label="Reload current activation"
        variant="secondary"
        disabled={busy || !runtime.online}
        onPress={() => {
          setPaths(initial);
          void onRefresh()
            .then(() => {
              setUncertain(false);
              setError(undefined);
            })
            .catch((cause) => setError(automationError(cause)));
        }}
      />
    </Card>
  );
}
