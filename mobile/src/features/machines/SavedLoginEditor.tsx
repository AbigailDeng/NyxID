import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, Switch } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import {
  ActionButton,
  Card,
  Field,
  Label,
  Notice,
} from "../../components/workspace/WorkspaceUI";
import { requestJson } from "../../lib/api/http";
import type { SavedLogin } from "./machineContracts";
import { machineKeys, useMachineWrite } from "./MachineUI";
import {
  createSavedLoginEditorApi,
  savedLoginInputSchema,
} from "./savedLoginEditorTransport";
import { desktopPrivacyQueue, type DesktopPrivacy } from "./desktopPrivacy";

const api = createSavedLoginEditorApi(requestJson);
export function SavedLoginEditor({
  userId,
  login,
  onClose,
  onSaved,
  onUncertain,
  onBusy,
}: {
  userId: string;
  login?: SavedLogin;
  onClose: () => void;
  onSaved: () => void;
  onUncertain: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const navigation = useNavigation();
  const write = useMachineWrite();
  const replacing = !!login;
  const [ownerId, setOwnerId] = useState(login?.owner_id ?? userId);
  const [label, setLabel] = useState(login?.label ?? "");
  const [origins, setOrigins] = useState(
    login?.allowed_origins.join("\n") ?? "",
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [confirm, setConfirm] = useState(login?.confirm_each_sign_in ?? true);
  const [validation, setValidation] = useState<string>();
  const [acknowledged, setAcknowledged] = useState(!login);
  const [privacyReady, setPrivacyReady] = useState(false);
  const [privacyError, setPrivacyError] = useState(false);
  const [backgroundCleared, setBackgroundCleared] = useState(false);
  const submitting = useRef(false);
  const draftGeneration = useRef(0);
  const renderedDraftGeneration = draftGeneration.current;
  useEffect(() => {
    let mounted = true;
    let privacy: DesktopPrivacy | undefined;
    void desktopPrivacyQueue(async () => {
      privacy = await import("expo-screen-capture");
      await privacy.preventScreenCaptureAsync("saved-login-editor");
      if (Platform.OS === "ios")
        await privacy.enableAppSwitcherProtectionAsync(1);
      if (mounted) setPrivacyReady(true);
    }).catch(() => {
      if (mounted) setPrivacyError(true);
    });
    return () => {
      mounted = false;
      void desktopPrivacyQueue(async () => {
        if (!privacy) return;
        if (Platform.OS === "ios")
          await privacy.disableAppSwitcherProtectionAsync();
        await privacy.allowScreenCaptureAsync("saved-login-editor");
      }).catch(() => {});
    };
  }, []);
  const owners = useQuery({
    queryKey: [...machineKeys(write.epoch), "login-owners"],
    queryFn: ({ signal }) => api.owners(signal),
    enabled: write.active,
    retry: false,
  });
  const clearSecrets = useCallback(() => {
    draftGeneration.current++;
    setPassword("");
    setTotp("");
  }, []);
  const clear = useCallback(() => {
    setUsername("");
    clearSecrets();
    setBackgroundCleared(false);
    setAcknowledged(!replacing);
  }, [clearSecrets, replacing]);
  function selectOwner(id: string) {
    clear();
    setOwnerId(id);
  }
  useEffect(() => {
    clear();
    setOwnerId(login?.owner_id ?? userId);
  }, [userId, write.epoch, login?.owner_id, clear]);
  useEffect(() => {
    // An interruption may only become inactive. Keep its draft protected by
    // the native privacy overlay; actual background events erase secrets even
    // when React batches background and foreground into one render.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        clearSecrets();
        setBackgroundCleared(true);
        setAcknowledged(!replacing);
      }
    });
    const unsubscribeBlur = navigation.addListener("blur", clear);
    return () => {
      subscription.remove();
      unsubscribeBlur();
    };
  }, [navigation, clear, clearSecrets, replacing]);
  useEffect(() => {
    if (write.uncertain) onUncertain();
  }, [write.uncertain]);
  const owner =
    ownerId === userId
      ? "Your personal account"
      : !owners.isError
        ? (owners.data?.find((org) => org.id === ownerId)?.display_name ??
          owners.data?.find((org) => org.id === ownerId)?.slug)
        : undefined;
  const enabled =
    privacyReady && write.active && !!owner && !write.busy && !write.uncertain;
  async function submit() {
    if (
      submitting.current ||
      renderedDraftGeneration !== draftGeneration.current ||
      !enabled ||
      !acknowledged ||
      !write.interactive()
    )
      return;
    const parsed = savedLoginInputSchema.safeParse({
      label,
      allowed_origins: origins
        .split(/\n|,/)
        .map((value) => value.trim())
        .filter(Boolean),
      username,
      password,
      totp_secret: totp,
      confirm_each_sign_in: confirm,
    });
    if (!parsed.success) {
      setValidation(
        "Enter a label and username, and 1–16 exact HTTPS origins without paths or wildcards. Check the credential lengths.",
      );
      return;
    }
    // Own the parent lock for the whole submit, including any run admission
    // refusal. A queued press must not release another submit's pending lock.
    submitting.current = true;
    setValidation(undefined);
    clear();
    onBusy(true);
    try {
      await write.run(async (current) => {
        await api.save(parsed.data, ownerId, userId, current, login);
        if (current()) {
          onSaved();
          onClose();
        }
      });
    } finally {
      parsed.data.username = "";
      parsed.data.password = "";
      parsed.data.totp_secret = "";
      submitting.current = false;
      onBusy(false);
    }
  }
  return (
    <Card>
      <Label>{login ? `Replace ${login.label}` : "Add saved login"}</Label>
      <Label muted>
        Secrets are write-only. Enter them here, never in chat. Entering the
        background clears the password and authenticator secret, but keeps the
        username. Leaving this editor clears all credential fields.
      </Label>
      {backgroundCleared && (
        <Notice message="Password and authenticator fields were cleared when the app entered the background. Re-enter any secrets you want to save." />
      )}
      <Label>Owner: {owner ?? "Organization access unavailable"}</Label>
      {!privacyReady && (
        <Notice
          message={
            privacyError
              ? "Credential privacy protection is unavailable in this build. Cancel and use Saved logins on web, or update the app."
              : "Protecting credential entry…"
          }
        />
      )}
      {!login && (
        <>
          <ActionButton
            compact
            label="Use personal account"
            variant="secondary"
            disabled={write.busy}
            onPress={() => selectOwner(userId)}
          />
          {!owners.isError &&
            owners.data?.map((org) => (
              <ActionButton
                key={org.id}
                compact
                label={`Use ${org.display_name ?? org.slug}`}
                variant="secondary"
                disabled={write.busy}
                onPress={() => selectOwner(org.id)}
              />
            ))}
        </>
      )}
      {owners.isError && (
        <Notice message="Organization Admin membership could not be verified. Personal login creation is still available." />
      )}
      {login && (
        <Notice message="Replacement is complete, not a partial edit: re-enter the username and every secret you want to keep. Empty password or authenticator fields remove the stored values. The owner cannot change." />
      )}
      <Field
        label="Label"
        value={label}
        editable={!write.busy}
        maxLength={100}
        onChangeText={setLabel}
      />
      <Field
        label="Allowed HTTPS origins (one per line)"
        value={origins}
        editable={!write.busy}
        multiline
        autoCorrect={false}
        onChangeText={setOrigins}
        placeholder="https://github.com"
      />
      <Field
        label="Username"
        value={username}
        editable={enabled}
        maxLength={1024}
        autoCorrect={false}
        autoComplete="off"
        textContentType="none"
        onChangeText={setUsername}
      />
      <Field
        label="Password (optional)"
        value={password}
        editable={enabled}
        maxLength={16384}
        secureTextEntry
        autoComplete="off"
        textContentType="none"
        onChangeText={setPassword}
      />
      <Field
        label="Authenticator secret or otpauth URL (optional)"
        value={totp}
        editable={enabled}
        maxLength={4096}
        secureTextEntry
        autoCorrect={false}
        autoComplete="off"
        textContentType="none"
        onChangeText={setTotp}
      />
      <Label>Confirm every sign-in</Label>
      <Switch
        accessibilityLabel="Confirm every sign-in"
        value={confirm}
        disabled={write.busy}
        onValueChange={setConfirm}
      />
      <Label muted>
        A website that deliberately displays a typed password could expose it on
        screen. Use owner takeover for your most sensitive accounts.
      </Label>
      {login && (
        <>
          <Label>
            I understand that blank secrets remove the previous values.
          </Label>
          <Switch
            accessibilityLabel="Acknowledge full credential replacement"
            value={acknowledged}
            disabled={write.busy}
            onValueChange={setAcknowledged}
          />
        </>
      )}
      {validation && <Notice tone="error" message={validation} />}
      {write.error && <Notice tone="error" message={write.error} />}
      {write.uncertain && (
        <Notice message="The save may have reached the server. Close this editor, refresh saved logins and review the metadata before another save." />
      )}
      <ActionButton
        label={
          login
            ? "Replace all saved-login values"
            : "Save login for selected owner"
        }
        disabled={
          !enabled ||
          !acknowledged ||
          !label.trim() ||
          !username ||
          !origins.trim()
        }
        loading={write.busy}
        onPress={() => void submit()}
      />
      <ActionButton
        label="Cancel and clear credentials"
        variant="secondary"
        disabled={write.busy}
        onPress={() => {
          clear();
          onClose();
        }}
      />
    </Card>
  );
}
