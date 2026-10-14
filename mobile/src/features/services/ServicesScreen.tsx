import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import {
  ChevronRight,
  KeyRound,
  PlugZap,
  ShieldCheck,
} from "lucide-react-native";
import {
  ActionButton,
  Card,
  Field,
  Label,
  Notice,
  WorkspacePage,
} from "../../components/workspace/WorkspaceUI";
import { ApiError } from "../../lib/api/ApiError";
import { servicesApi } from "../../lib/api/servicesApi";
import { useWorkspaceBack } from "../../app/WorkspaceHeader";
import { fonts } from "../../theme/designTokens";
import { useTheme } from "../../theme/ThemeContext";
import {
  buildCatalogConnectionInput,
  canEditConnection,
  catalogForConnection,
  connectionOwner,
  supportsCredentialForm,
  supportsManagedOAuth,
  validateBrowserUrl,
  type CatalogEntry,
  type ServiceConnection,
} from "./serviceContracts";

const ROOT = ["workspace", "services"] as const;
const messageOf = (cause: unknown) =>
  cause instanceof Error
    ? cause.message
    : "Could not complete this action. Try again.";

export function ServicesScreen() {
  const { colors } = useTheme();
  const focused = useIsFocused();
  const queryClient = useQueryClient();
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const [tab, setTab] = useState<"connected" | "catalog">("connected");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [adding, setAdding] = useState<CatalogEntry>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [tokenOnlyRemoval, setTokenOnlyRemoval] = useState(false);
  const [replacement, setReplacement] = useState("");
  const actionLock = useRef(false);
  const connections = useQuery({
    queryKey: [...ROOT, "connections"],
    queryFn: ({ signal }) => servicesApi.connections(signal),
    retry: false,
    enabled: focused && foreground,
  });
  const catalog = useQuery({
    queryKey: [...ROOT, "catalog"],
    queryFn: ({ signal }) => servicesApi.catalog(signal),
    retry: false,
    enabled: focused && foreground,
    staleTime: 60_000,
  });
  const detail = useQuery({
    queryKey: [...ROOT, "connection", selectedId],
    queryFn: ({ signal }) => servicesApi.connection(selectedId!, signal),
    enabled: focused && foreground && Boolean(selectedId),
    retry: false,
  });

  const reload = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ROOT });
    await queryClient.invalidateQueries({ queryKey: ["workspace", "agents"] });
  }, [queryClient]);

  useEffect(() => {
    if (!focused) return;
    const subscription = AppState.addEventListener("change", (state) => {
      setForeground(state === "active");
      if (state === "active") void reload();
      else setReplacement("");
    });
    return () => subscription.remove();
  }, [focused, reload]);

  useEffect(() => {
    if (!focused) setReplacement("");
  }, [focused]);

  function closeDetail() {
    setSelectedId(undefined);
    setAdding(undefined);
    setError(undefined);
    setConfirmRemove(false);
    setTokenOnlyRemoval(false);
    setReplacement("");
  }
  useWorkspaceBack({
    active: Boolean(selectedId) || Boolean(adding),
    disabled: busy,
    label: "Back to services",
    onBack: () => {
      if (!actionLock.current) closeDetail();
    },
  });

  async function run(action: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }

  async function authorize(connection: ServiceConnection, entry: CatalogEntry) {
    if (!entry.provider_config_id)
      throw new Error("This service has no OAuth provider configured.");
    const org =
      connection.credential_source?.type === "org"
        ? connection.credential_source.org_id
        : undefined;
    const response = await servicesApi.initiateOAuth(
      entry.provider_config_id,
      connection.id,
      org,
    );
    await WebBrowser.openBrowserAsync(
      validateBrowserUrl(response.authorization_url),
    );
    await reload();
    const latest = await servicesApi.connection(connection.id);
    queryClient.setQueryData([...ROOT, "connection", connection.id], latest);
    const authorized =
      latest.status === "active" &&
      (connection.status !== "active" ||
        latest.last_authorized_at !== connection.last_authorized_at);
    setNotice(
      authorized
        ? "Authorization completed. Your connection is ready."
        : "Authorization has not completed yet. Finish it in the browser, then check again.",
    );
  }

  async function remove(connection: ServiceConnection) {
    try {
      const result = await servicesApi.remove(connection.id, tokenOnlyRemoval);
      if (!result.deleted)
        throw new Error(result.message || "The connection was not removed.");
      closeDetail();
      await reload();
      setNotice(
        result.upstream_revocation_scheduled
          ? "Connection removed. Provider authorization revocation was scheduled."
          : "Connection removed.",
      );
    } catch (cause) {
      if (cause instanceof ApiError && cause.errorCode === 11500) {
        setTokenOnlyRemoval(true);
        setError(
          "Other connections share this provider authorization. You can remove only this service below; the provider authorization and other connections will be kept.",
        );
      } else {
        throw cause;
      }
    }
  }

  if (adding) {
    return (
      <ConnectForm
        entry={adding}
        busy={busy}
        error={error}
        onCancel={closeDetail}
        onSubmit={(values) =>
          void run(async () => {
            const connection = await servicesApi.create(
              buildCatalogConnectionInput(adding, values),
            );
            setSelectedId(connection.id);
            setAdding(undefined);
            setReplacement("");
            await reload();
            if (!values.platform && supportsManagedOAuth(adding))
              await authorize(connection, adding);
            else
              setNotice("Connection added. Its status below comes from NyxID.");
          })
        }
      />
    );
  }

  if (selectedId) {
    const connection = detail.data;
    const entry =
      connection && catalogForConnection(connection, catalog.data ?? []);
    const editable = connection && canEditConnection(connection);
    const replaceable =
      editable &&
      Boolean(connection.api_key_id) &&
      !["oauth2", "node_managed"].includes(connection.credential_type) &&
      connection.status !== "pending_auth" &&
      connection.credential_binding !== "platform" &&
      (!entry ||
        (supportsCredentialForm(entry) &&
          !entry.token_exchange_credential_fields?.length));
    return (
      <WorkspacePage
        title={
          connection?.catalog_service_name ?? connection?.label ?? "Connection"
        }
        subtitle="Manage this service connection"
      >
        <ActionButton
          label="Back to services"
          onPress={closeDetail}
          disabled={busy}
          variant="secondary"
        />
        {notice && <Notice message={notice} tone="success" />}
        {error && <Notice message={error} tone="error" />}
        {detail.isPending && (
          <ActivityIndicator
            color={colors.primary}
            accessibilityLabel="Loading connection"
          />
        )}
        {detail.isError && (
          <>
            <Notice message={messageOf(detail.error)} tone="error" />
            <ActionButton label="Retry" onPress={() => void detail.refetch()} />
          </>
        )}
        {connection && (
          <>
            <Card>
              <Label>{connection.label}</Label>
              <Label mono muted>
                {connection.slug}
              </Label>
              <Label muted>
                {connectionOwner(connection)} ·{" "}
                {connection.credential_binding === "platform"
                  ? "Platform key"
                  : connection.credential_type}
              </Label>
              <View style={styles.statusRow}>
                <Text
                  style={[
                    styles.status,
                    {
                      color:
                        connection.status === "active"
                          ? colors.success
                          : colors.warning,
                    },
                  ]}
                >
                  {connection.credential_missing
                    ? "Credential missing"
                    : connection.status.replaceAll("_", " ")}
                </Text>
                <Label muted>
                  {connection.is_active ? "Enabled" : "Disabled"}
                </Label>
              </View>
              {(connection.description ?? entry?.description) && (
                <Label muted>
                  {connection.description ?? entry?.description}
                </Label>
              )}
              {connection.error_message && (
                <Notice message={connection.error_message} tone="error" />
              )}
              {connection.proxy_url && (
                <Label mono muted>
                  {connection.proxy_url}
                </Label>
              )}
            </Card>
            {!editable && (
              <Notice
                message={
                  connection.auto_connected
                    ? "This connection is managed by the platform."
                    : "Your current role can view this connection. An organization admin manages it."
                }
              />
            )}
            {editable && (
              <Card>
                <View style={styles.statusRow}>
                  <View style={styles.flex}>
                    <Label>Allow this connection</Label>
                    <Label muted>
                      Disabling keeps the credential and stops service use.
                    </Label>
                  </View>
                  <Switch
                    accessibilityLabel="Allow this connection"
                    value={connection.is_active}
                    disabled={busy}
                    trackColor={{ true: colors.primary }}
                    onValueChange={(active) =>
                      void run(async () => {
                        await servicesApi.setActive(connection.id, active);
                        await reload();
                      })
                    }
                  />
                </View>
                {entry && supportsManagedOAuth(entry) && (
                  <ActionButton
                    label={
                      connection.status === "active"
                        ? "Authorize again"
                        : "Complete authorization"
                    }
                    disabled={busy}
                    onPress={() => void run(() => authorize(connection, entry))}
                  />
                )}
                {replaceable && (
                  <>
                    <Field
                      label="Replace credential"
                      value={focused && foreground ? replacement : ""}
                      onChangeText={setReplacement}
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!busy}
                      placeholder="Enter a new credential"
                    />
                    <ActionButton
                      label="Save new credential"
                      disabled={busy || !replacement.trim()}
                      onPress={() =>
                        void run(async () => {
                          await servicesApi.replaceCredential(
                            connection.id,
                            replacement.trim(),
                          );
                          setReplacement("");
                          await reload();
                          setNotice("Credential replaced.");
                        })
                      }
                    />
                  </>
                )}
              </Card>
            )}
            {(entry?.documentation_url ?? connection.docs_url) && (
              <ActionButton
                label="Open documentation"
                variant="secondary"
                onPress={() =>
                  void run(async () => {
                    await Linking.openURL(
                      validateBrowserUrl(
                        entry?.documentation_url ?? connection.docs_url!,
                      ),
                    );
                  })
                }
                disabled={busy}
              />
            )}
            {editable && (
              <Card>
                <Label>Remove connection</Label>
                <Label muted>
                  {connection.revocation?.revokes_grant
                    ? "Removing may also revoke NyxID's provider authorization. Shared grants need a separate confirmation."
                    : "Remove this service and its connection from NyxID."}
                </Label>
                {confirmRemove ? (
                  <>
                    <Notice
                      message={
                        tokenOnlyRemoval
                          ? "Only this connection will be removed. Provider authorization remains active."
                          : `Remove “${connection.label}”? Agents using it will lose access.`
                      }
                    />
                    <ActionButton
                      label={
                        tokenOnlyRemoval
                          ? "Remove only this service"
                          : "Confirm removal"
                      }
                      variant="danger"
                      loading={busy}
                      onPress={() => void run(() => remove(connection))}
                    />
                    <ActionButton
                      label="Cancel"
                      variant="secondary"
                      disabled={busy}
                      onPress={() => {
                        setConfirmRemove(false);
                        setTokenOnlyRemoval(false);
                        setError(undefined);
                      }}
                    />
                  </>
                ) : (
                  <ActionButton
                    label="Remove connection"
                    variant="danger"
                    disabled={busy}
                    onPress={() => setConfirmRemove(true)}
                  />
                )}
              </Card>
            )}
            <ActionButton
              label="Check connection status"
              variant="secondary"
              disabled={busy || detail.isFetching}
              onPress={() => void run(reload)}
            />
          </>
        )}
      </WorkspacePage>
    );
  }

  const query = search.trim().toLowerCase();
  const filteredConnections = (connections.data ?? []).filter((item) =>
    `${item.label} ${item.slug} ${item.catalog_service_name ?? ""} ${connectionOwner(item)}`
      .toLowerCase()
      .includes(query),
  );
  const filteredCatalog = (catalog.data ?? []).filter((item) =>
    `${item.name} ${item.slug} ${item.description ?? ""}`
      .toLowerCase()
      .includes(query),
  );
  const current = tab === "connected" ? connections : catalog;
  return (
    <WorkspacePage title="Services" showHeading={false}>
      {notice && <Notice message={notice} tone="success" />}
      {error && <Notice message={error} tone="error" />}
      <View style={styles.search}>
        <Text style={[styles.searchLabel, { color: colors.textSecondary }]}>
          Search services
        </Text>
        <TextInput
          accessibilityLabel="Search services"
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or service"
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.primary}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          onSubmitEditing={Keyboard.dismiss}
          style={[
            styles.searchInput,
            {
              color: colors.textPrimary,
              borderColor: colors.border,
              backgroundColor: colors.cardSoft,
            },
          ]}
        />
      </View>
      <View
        style={[
          styles.tabs,
          { backgroundColor: colors.cardSoft, borderColor: colors.border },
        ]}
      >
        {(["connected", "catalog"] as const).map((value) => (
          <Pressable
            key={value}
            onPress={() => {
              setTab(value);
              setError(undefined);
            }}
            accessibilityRole="tab"
            hitSlop={{ top: 2, bottom: 2 }}
            accessibilityState={{ selected: tab === value }}
            style={[
              styles.tab,
              {
                backgroundColor:
                  tab === value ? colors.navActive : "transparent",
              },
            ]}
          >
            <Text
              style={[
                styles.tabLabel,
                {
                  color: tab === value ? colors.textPrimary : colors.textMuted,
                },
              ]}
            >
              {value === "connected" ? "Connected" : "Explore catalog"}
            </Text>
          </Pressable>
        ))}
      </View>
      {current.isPending && (
        <ActivityIndicator
          accessibilityLabel="Loading services"
          color={colors.primary}
        />
      )}
      {current.isError && (
        <>
          <Notice message={messageOf(current.error)} tone="error" />
          <ActionButton
            label="Retry loading"
            onPress={() => void current.refetch()}
          />
        </>
      )}
      <View style={styles.serviceList}>
        <Text
          accessibilityRole="header"
          style={[styles.sectionTitle, { color: colors.textPrimary }]}
        >
          {tab === "connected" ? "Connected services" : "Available to add"}
        </Text>
        {tab === "connected" &&
          filteredConnections.map((connection) => (
            <Pressable
              key={connection.id}
              accessibilityRole="button"
              accessibilityLabel={`Manage ${connection.label}`}
              onPress={() => {
                setSelectedId(connection.id);
                setError(undefined);
                setNotice(undefined);
              }}
            >
              <Card style={styles.serviceCard}>
                <Text
                  style={[
                    styles.connectionStatus,
                    {
                      color:
                        connection.is_active && connection.status === "active"
                          ? colors.success
                          : colors.textSecondary,
                    },
                  ]}
                >
                  ●{" "}
                  {connection.is_active
                    ? connection.status.replaceAll("_", " ")
                    : "Disabled"}
                </Text>
                <View style={styles.row}>
                  <View
                    style={[styles.icon, { backgroundColor: colors.ghostBg }]}
                  >
                    <PlugZap size={18} color={colors.primary} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={[styles.title, { color: colors.textPrimary }]}>
                      {connection.label}
                    </Text>
                    <Label muted style={styles.cardDescription}>
                      {connectionOwner(connection)}
                    </Label>
                    <Label mono muted style={styles.cardMetadata}>
                      {connection.slug}
                    </Label>
                  </View>
                  <ChevronRight color={colors.textMuted} size={18} />
                </View>
              </Card>
            </Pressable>
          ))}
        {tab === "catalog" &&
          filteredCatalog.map((entry) => (
            <Pressable
              key={entry.slug}
              accessibilityRole="button"
              accessibilityLabel={`Connect ${entry.name}`}
              onPress={() => {
                setAdding(entry);
                setError(undefined);
                setNotice(undefined);
              }}
            >
              <Card style={styles.serviceCard}>
                <Text
                  style={[styles.connectionStatus, { color: colors.primary }]}
                >
                  ●{" "}
                  {entry.platform_key?.available
                    ? "Platform key available"
                    : "Connect"}
                </Text>
                <View style={styles.row}>
                  <View
                    style={[styles.icon, { backgroundColor: colors.ghostBg }]}
                  >
                    {entry.platform_key?.available ? (
                      <ShieldCheck size={18} color={colors.primary} />
                    ) : (
                      <KeyRound size={18} color={colors.primary} />
                    )}
                  </View>
                  <View style={styles.flex}>
                    <Text style={[styles.title, { color: colors.textPrimary }]}>
                      {entry.name}
                    </Text>
                    <Label muted style={styles.cardDescription}>
                      {entry.description ?? entry.slug}
                    </Label>
                  </View>
                  <ChevronRight color={colors.textMuted} size={18} />
                </View>
              </Card>
            </Pressable>
          ))}
      </View>
      {!current.isPending &&
        !current.isError &&
        !(tab === "connected"
          ? filteredConnections.length
          : filteredCatalog.length) && (
          <Card>
            <Label>
              {search
                ? "No matching services"
                : tab === "connected"
                  ? "Connect your first service"
                  : "No services available"}
            </Label>
            <Label muted>
              {search
                ? "Try another name or clear your search."
                : "Explore the catalog to add a connection."}
            </Label>
            {tab === "connected" && (
              <ActionButton
                label="Explore catalog"
                onPress={() => {
                  setTab("catalog");
                  setSearch("");
                }}
              />
            )}
          </Card>
        )}
      <ActionButton
        label="Refresh services"
        variant="secondary"
        disabled={current.isFetching}
        onPress={() => void reload()}
      />
    </WorkspacePage>
  );
}

function ConnectForm({
  entry,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  entry: CatalogEntry;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (values: {
    label: string;
    credential: string;
    endpointUrl: string;
    fields: Record<string, string>;
    platform: boolean;
  }) => void;
}) {
  const { colors } = useTheme();
  const [label, setLabel] = useState(entry.name);
  const [credential, setCredential] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [platform, setPlatform] = useState(false);
  const [linkError, setLinkError] = useState<string>();
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  useEffect(() => {
    if (!focused) {
      setCredential("");
      setFields({});
    }
  }, [focused]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setForeground(state === "active");
      if (state !== "active") {
        setCredential("");
        setFields({});
      }
    });
    return () => subscription.remove();
  }, []);
  const supported =
    platform || supportsCredentialForm(entry) || supportsManagedOAuth(entry);
  const oauth = !platform && supportsManagedOAuth(entry);
  return (
    <WorkspacePage
      title={`Connect ${entry.name}`}
      subtitle="Add a personal connection"
    >
      <ActionButton
        label="Back to catalog"
        variant="secondary"
        onPress={onCancel}
        disabled={busy}
      />
      {error && <Notice message={error} tone="error" />}
      {linkError && <Notice message={linkError} tone="error" />}
      {entry.description && <Label muted>{entry.description}</Label>}
      <Card>
        <Field
          label="Connection name"
          value={label}
          onChangeText={setLabel}
          editable={!busy}
          maxLength={200}
        />
        {entry.platform_key?.available && (
          <View style={styles.statusRow}>
            <View style={styles.flex}>
              <Label>Use platform key</Label>
              <Label muted>
                Charges and service access follow the current platform policy.
              </Label>
            </View>
            <Switch
              accessibilityLabel="Use platform key"
              value={platform}
              onValueChange={(value) => {
                setPlatform(value);
                if (value) {
                  setCredential("");
                  setFields({});
                }
              }}
              disabled={busy}
              trackColor={{ true: colors.primary }}
            />
          </View>
        )}
        {!platform && entry.requires_gateway_url && (
          <Field
            label="Gateway URL"
            value={endpointUrl}
            onChangeText={setEndpointUrl}
            editable={!busy}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://your-service.example"
          />
        )}
        {!platform &&
          supportsCredentialForm(entry) &&
          entry.token_exchange_credential_fields?.map((field) => (
            <Field
              key={field.name}
              label={field.label}
              value={focused && foreground ? (fields[field.name] ?? "") : ""}
              onChangeText={(value) =>
                setFields((previous) => ({ ...previous, [field.name]: value }))
              }
              secureTextEntry={field.secret}
              placeholder={field.placeholder ?? undefined}
              editable={!busy}
              autoCorrect={false}
              autoCapitalize="none"
            />
          ))}
        {!platform &&
          supportsCredentialForm(entry) &&
          !entry.token_exchange_credential_fields?.length &&
          entry.requires_credential && (
            <Field
              label="API key / credential"
              value={focused && foreground ? credential : ""}
              onChangeText={setCredential}
              secureTextEntry
              editable={!busy}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Paste your service credential"
            />
          )}
        {!platform && entry.api_key_instructions && (
          <Label muted>{entry.api_key_instructions}</Label>
        )}
        {oauth && (
          <Notice message="Continue in your browser to authorize this connection. Return here to check its status." />
        )}
        {!supported && (
          <Notice message="This service needs a specialized connection setup. Complete its setup in the Web dashboard, then refresh your connections here." />
        )}
        <ActionButton
          label={oauth ? "Continue to authorization" : "Add connection"}
          loading={busy}
          disabled={!supported || !label.trim() || !focused || !foreground}
          onPress={() =>
            onSubmit({ label, credential, endpointUrl, fields, platform })
          }
        />
      </Card>
      {entry.api_key_url && (
        <ActionButton
          label="Get a credential"
          variant="secondary"
          disabled={busy}
          onPress={() => {
            setLinkError(undefined);
            void Promise.resolve()
              .then(() =>
                Linking.openURL(validateBrowserUrl(entry.api_key_url!)),
              )
              .catch((cause) => setLinkError(messageOf(cause)));
          }}
        />
      )}
    </WorkspacePage>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  icon: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  title: { fontFamily: fonts.bodySemi, fontSize: 14, lineHeight: 20 },
  serviceList: { gap: 12 },
  sectionTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  serviceCard: { minHeight: 114, borderRadius: 13, gap: 8 },
  connectionStatus: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    lineHeight: 14,
    textTransform: "capitalize",
  },
  cardDescription: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    lineHeight: 19,
  },
  cardMetadata: { fontSize: 11, lineHeight: 16 },
  status: { fontFamily: fonts.mono, fontSize: 12, textTransform: "capitalize" },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 14,
  },
  tabs: {
    flexDirection: "row",
    padding: 3,
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
  },
  tab: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
  },
  tabLabel: { fontFamily: fonts.bodySemi, fontSize: 12, lineHeight: 18 },
  search: { gap: 8 },
  searchLabel: { fontFamily: fonts.bodySemi, fontSize: 12, lineHeight: 16 },
  searchInput: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
  },
});
