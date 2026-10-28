import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, X } from "lucide-react-native";
import { Label } from "../../components/workspace/WorkspaceUI";
import {
  workspaceCloseControlStyle,
  WORKSPACE_CLOSE_ICON_SIZE,
} from "../../components/workspace/workspaceCloseControl";
import { useTheme } from "../../theme/ThemeContext";
import { assistantApi } from "../../lib/api/assistantApi";
import { getAuthEpoch } from "../../lib/auth/authEpoch";
import { useGroupAvailability } from "../groups/useGroupRuntime";
import {
  COMPOSER_ACCESS_LABEL,
  composerModelName,
  composerModelOptions,
  type ComposerAccessMode,
} from "./composerSettings";

type Props = {
  scope: string;
  conversationId?: string;
  model: string;
  agentOverride?: ComposerAccessMode | null;
  advanced: boolean;
  activeTurn: boolean;
  disabled: boolean;
  visible: boolean;
  onOpenChange: (open: boolean) => void;
  onModelChanged: (model: string) => void;
};

/** Owner permissions are separate from the human-only per-agent override editor. */
export function AssistantComposerSettings(props: Props) {
  const { colors } = useTheme();
  const availability = useGroupAvailability();
  const queryClient = useQueryClient();
  const epoch = getAuthEpoch();
  const settingsKey = ["assistant", "composer-settings", epoch];
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: ({ signal }) => assistantApi.settings(signal),
    enabled: availability.active,
    retry: false,
  });
  const models = useQuery({
    queryKey: ["assistant", "composer-models", epoch],
    queryFn: () => assistantApi.models(),
    enabled: availability.active,
    retry: false,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const lock = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ props, availability });
  latest.current = { props, availability };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setError(undefined);
    props.onOpenChange(false);
  }, [props.scope]);
  const thinking = props.model === "nyxagent/research";
  const nextThinking = thinking ? "nyxagent/chat" : "nyxagent/research";
  const options = composerModelOptions(models.data, props.model);
  const name = composerModelName(
    options.find((row) => row.id === props.model)!,
  );
  const mode = props.agentOverride ?? settings.data?.access_mode;
  const accessLabel = mode ? COMPOSER_ACCESS_LABEL[mode] : "Permissions";
  const title = props.advanced
    ? "Model and permissions"
    : "Thinking and permissions";
  const modelLocked =
    props.activeTurn || pending || models.isPending || models.isError;
  const permissionLocked =
    props.activeTurn || !!props.agentOverride || pending || !settings.data;
  const unavailable = props.disabled || !availability.active;
  async function change(kind: "model" | "permissions", value: string) {
    const state = latest.current;
    if (
      lock.current ||
      !state.availability.available() ||
      state.props.disabled ||
      state.props.activeTurn ||
      getAuthEpoch() !== epoch
    )
      return;
    if (
      kind === "permissions" &&
      (state.props.agentOverride || !settings.data || value === mode)
    )
      return;
    if (
      kind === "model" &&
      (models.isPending ||
        models.isError ||
        value === state.props.model ||
        !options.some((row) => row.id === value && row.available))
    )
      return;
    const scope = state.props.scope;
    const current = () =>
      mounted.current &&
      getAuthEpoch() === epoch &&
      latest.current.props.scope === scope;
    lock.current = true;
    setPending(true);
    setError(undefined);
    try {
      if (kind === "permissions") {
        // The web composer updates directly, including Full access (no confirmation).
        const result = await assistantApi.updateAccessMode(
          value as ComposerAccessMode,
        );
        if (current()) queryClient.setQueryData(settingsKey, result);
      } else {
        if (state.props.conversationId)
          await assistantApi.changeModel(state.props.conversationId, value);
        if (current()) latest.current.props.onModelChanged(value);
      }
    } catch (cause) {
      if (current())
        setError(
          cause instanceof Error
            ? cause.message
            : kind === "permissions"
              ? "Could not change permissions."
              : "Could not change the model.",
        );
    } finally {
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  }
  function row(
    label: string,
    selected: boolean,
    disabled: boolean,
    onPress: () => void,
    checkbox = false,
  ) {
    return (
      <Pressable
        key={label}
        accessibilityRole={checkbox ? "checkbox" : "radio"}
        accessibilityLabel={checkbox ? "Thinking mode" : label}
        accessibilityState={{
          checked: selected,
          disabled: disabled || unavailable,
        }}
        disabled={disabled || unavailable}
        onPress={onPress}
        style={{
          minHeight: 44,
          paddingHorizontal: 12,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderRadius: 8,
          backgroundColor: selected ? colors.cardSoft : "transparent",
          opacity: disabled || unavailable ? 0.5 : 1,
        }}
      >
        <Label style={{ flex: 1, fontSize: 14 }}>{label}</Label>
        {selected ? <Check size={16} color={colors.textSecondary} /> : null}
      </Pressable>
    );
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${props.advanced ? name : `${accessLabel}${thinking ? ", Thinking" : ""}`}${props.advanced && mode ? `, ${accessLabel}` : ""}${props.agentOverride ? " (this agent)" : ""}`}
        disabled={unavailable}
        onPress={() => props.onOpenChange(true)}
        style={{
          minHeight: 44,
          minWidth: 44,
          maxWidth: 180,
          flexShrink: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: 6,
          opacity: unavailable ? 0.5 : 1,
        }}
      >
        <Label
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 12, flexShrink: 1 }}
        >
          {props.advanced
            ? name
            : `${accessLabel}${thinking ? ", Thinking" : ""}`}
        </Label>
        <ChevronDown size={12} color={colors.textSecondary} />
      </Pressable>
      <Modal
        visible={
          props.visible && availability.focused && availability.foreground
        }
        transparent
        animationType="fade"
        onRequestClose={() => props.onOpenChange(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            padding: 20,
            backgroundColor: colors.sheetScrim,
          }}
          accessibilityViewIsModal
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 16,
              maxHeight: "85%",
              width: "100%",
              maxWidth: 520,
              alignSelf: "center",
              overflow: "hidden",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 12,
                gap: 8,
              }}
            >
              <Label
                accessibilityRole="header"
                numberOfLines={1}
                maxFontSizeMultiplier={1.25}
                style={{ fontSize: 18, flex: 1 }}
              >
                {title}
              </Label>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Close ${title.toLowerCase()}`}
                style={workspaceCloseControlStyle(colors.cardSoft)}
                onPress={() => props.onOpenChange(false)}
              >
                <X
                  size={WORKSPACE_CLOSE_ICON_SIZE}
                  color={colors.textSecondary}
                />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={{ padding: 12, gap: 4 }}
              keyboardShouldPersistTaps="handled"
            >
              {error ? (
                <Label
                  accessibilityRole="alert"
                  style={{ color: colors.danger }}
                >
                  {error}
                </Label>
              ) : null}
              {!props.advanced ? (
                row(
                  "Thinking",
                  thinking,
                  modelLocked ||
                    !options.some(
                      (row) => row.id === nextThinking && row.available,
                    ),
                  () => void change("model", nextThinking),
                  true,
                )
              ) : (
                <>
                  <Label muted>Reasoning · Unavailable</Label>
                  <Label accessibilityRole="header">Model · {name}</Label>
                  {options.map((option) =>
                    row(
                      `${composerModelName(option)}${!option.available && !models.isPending ? " (unavailable)" : ""}`,
                      option.id === props.model,
                      modelLocked || !option.available,
                      () => void change("model", option.id),
                    ),
                  )}
                </>
              )}
              {models.isError ? (
                <Pressable
                  accessibilityRole="button"
                  style={{ minHeight: 44, justifyContent: "center" }}
                  disabled={unavailable}
                  onPress={() => void models.refetch()}
                >
                  <Label>
                    {props.advanced
                      ? "Retry loading models"
                      : "Retry loading settings"}
                  </Label>
                </Pressable>
              ) : null}
              <Label accessibilityRole="header" style={{ paddingTop: 8 }}>
                Permissions · {mode ? COMPOSER_ACCESS_LABEL[mode] : "Loading…"}
                {props.agentOverride ? " · agent" : ""}
              </Label>
              {(["autopilot", "nyxmode", "ask_every_time"] as const).map(
                (value) =>
                  row(
                    COMPOSER_ACCESS_LABEL[value],
                    mode === value,
                    permissionLocked,
                    () => void change("permissions", value),
                  ),
              )}
              {settings.isError ? (
                <Pressable
                  accessibilityRole="button"
                  style={{ minHeight: 44, justifyContent: "center" }}
                  disabled={unavailable}
                  onPress={() => void settings.refetch()}
                >
                  <Label>Retry loading permissions</Label>
                </Pressable>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
