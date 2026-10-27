import assert from "node:assert/strict";
import { URL, fileURLToPath } from "node:url";
import test from "node:test";
import { hookHarness } from "../assistant/assistantHookTestHarness";
import { lightColors } from "../../theme/mobileTheme";

type Element = { type: unknown; props: Record<string, any> };
const style = (node: Element) =>
  Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
function elements(root: Element): Element[] {
  return [
    root,
    ...[root.props.children]
      .flat(Infinity)
      .flatMap((child) =>
        child && typeof child === "object" && "props" in child
          ? elements(child)
          : [],
      ),
  ];
}
function renderRows(node: Element): Element {
  if (typeof node.type === "function" && node.type.name === "AccountRow") {
    return node.type(node.props);
  }
  const render = (child: unknown): unknown =>
    Array.isArray(child)
      ? child.map(render)
      : child && typeof child === "object" && "props" in child
        ? renderRows(child as Element)
        : child;
  return {
    ...node,
    props: { ...node.props, children: render(node.props.children) },
  };
}
function setup(connectedTelegram = false, pushDevices = 0) {
  let dimensions = { width: 402, height: 874, fontScale: 1, scale: 3 };
  const mutations: unknown[] = [];
  const jsx = (type: unknown, props: Element["props"]) => ({ type, props });
  const harness = hookHarness<Element>({
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      ...Object.fromEntries(
        ["View", "Text", "Image", "Pressable", "ScrollView", "Switch"].map(
          (name) => [name, name],
        ),
      ),
      StyleSheet: { create: (styles: unknown) => styles },
      useWindowDimensions: () => dimensions,
    },
    "react-native-svg": {
      __esModule: true,
      default: "Svg",
      Circle: "Circle",
      Path: "Path",
    },
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useQuery: ({ queryKey }: { queryKey: string[] }) => ({
        data:
          queryKey[1] === "profile"
            ? {
                display_name: "Alex Example",
                email: "alex.long-address@example.test",
                social_provider: null,
              }
            : queryKey[1] === "notificationSettings"
              ? {
                  push_device_count: pushDevices,
                  push_enabled: true,
                  telegram_connected: connectedTelegram,
                  telegram_enabled: true,
                  telegram_username: "a_very_long_telegram_username",
                  global_approval_mode: "writes_only",
                }
              : { enabled: true },
      }),
      useMutation: () => ({
        mutate: (value: unknown) => mutations.push(value),
        isPending: false,
      }),
    },
    "../display/ChatDisplaySettings": {
      ChatDisplaySettings: "ChatDisplaySettings",
    },
    "../../components/PrimaryButton": { PrimaryButton: "PrimaryButton" },
    "../../components/ScreenContainer": { ScreenContainer: "ScreenContainer" },
    "../../components/OfflineBanner": { OfflineBanner: "OfflineBanner" },
    "../../components/TelegramLinkModal": {
      TelegramLinkModal: "TelegramLinkModal",
    },
    "../../components/ToastOverlay": { ToastOverlay: "ToastOverlay" },
    "../auth/AuthSessionContext": { useAuthSession: () => ({ signOut() {} }) },
    "../../lib/consent": {
      useMobileConsent: () => ({ accountId: "account", enabled: false }),
    },
    "../../lib/analyticsConsentState": {},
    "../../lib/analyticsRelay": {},
    "../../lib/api/http": {},
    "../../lib/telemetry": {},
    "../../hooks/useNetworkStatus": {
      useNetworkStatus: () => ({ isConnected: true }),
    },
    "../../lib/api/mobileApi": { mobileApi: {} },
    "../../lib/notifications/pushNotifications": {},
    "../../theme/ThemeContext": {
      useTheme: () => ({
        colors: lightColors,
        mode: "light",
        preference: "system",
      }),
    },
    "../../theme/flowStyles": { createFlowStyles: () => ({}) },
  });
  const { AccountSettingsScreen } = harness.load(
    fileURLToPath(new URL("./AccountSettingsScreen.tsx", import.meta.url)),
  ) as {
    AccountSettingsScreen: (props: any) => Element;
  };
  harness.mount(() => renderRows(AccountSettingsScreen({ navigation: {} })));
  const all = () => elements(harness.value());
  const text = (value: string) => {
    const node = all().find(
      (item) =>
        item.type === "Text" &&
        [item.props.children].flat(Infinity).join("") === value,
    );
    assert.ok(node, value);
    return node;
  };
  const parent = (child: Element) =>
    all().find((node) => [node.props.children].flat(Infinity).includes(child))!;
  return {
    all,
    text,
    parent,
    mutations,
    harness,
    resize(width: number, fontScale: number) {
      dimensions = { ...dimensions, width, fontScale };
      harness.render();
    },
  };
}

test("Settings reflows label/value, identity and control rows as Dynamic Type grows without suppressing text scaling", () => {
  const env = setup();
  assert.equal(
    style(env.parent(env.text("Sign-in Method"))).flexDirection,
    "row",
  );
  for (const [width, fontScale] of [
    [402, 3.12],
    [320, 1],
  ]) {
    env.resize(width!, fontScale!);
    for (const label of [
      "Sign-in Method",
      "Push Notifications",
      "Allow on this device",
      "Writes only (default)",
    ]) {
      const row = env.parent(env.text(label));
      assert.equal(style(row).flexDirection, "column", label);
      assert.equal(style(row).alignItems, "flex-start", label);
      assert.equal(style(row).height, undefined, label);
    }
    const value = env.text("Email/Password");
    assert.equal(style(value).textAlign, "left");
    assert.equal(style(env.parent(value)).maxWidth, "100%");
    const initials = env.text("AE");
    const avatar = env.parent(initials);
    assert.ok(style(avatar).height >= style(initials).lineHeight * fontScale!);
    assert.equal(style(env.parent(avatar)).flexDirection, "column");
    const identity = env.parent(env.text("alex.long-address@example.test"));
    assert.equal(style(identity).width, "100%");
    const enable = env.parent(env.text("Enable on this device"));
    assert.equal(style(enable).maxWidth, "100%");
    assert.ok(style(enable).minHeight >= 44);
    for (const node of env.all().filter((item) => item.type === "Text")) {
      assert.notEqual(node.props.allowFontScaling, false);
      assert.equal(node.props.maxFontSizeMultiplier, undefined);
      assert.equal(node.props.numberOfLines, undefined);
    }
  }
  env.resize(402, 1);
  assert.equal(
    style(env.parent(env.text("Sign-in Method"))).flexDirection,
    "row",
  );
  env.harness.unmount();
});

test("large-text notification rows retain connected identity and live push/Telegram switches", () => {
  const env = setup(true, 1);
  env.resize(402, 3.12);
  const telegramIdentity = env.parent(env.text("Telegram"));
  assert.equal(style(telegramIdentity).flexDirection, "column");
  assert.equal(style(telegramIdentity).maxWidth, "100%");
  assert.equal(
    style(env.parent(env.text("@a_very_long_telegram_username"))).maxWidth,
    "100%",
  );
  const pushRow = env.parent(env.text("Push Notifications"));
  const push = elements(pushRow).find((node) => node.type === "Switch")!;
  const telegramRow = env.parent(telegramIdentity);
  const telegram = elements(telegramRow).find(
    (node) => node.type === "Switch",
  )!;
  assert.ok(push && telegram);
  push.props.onValueChange(true);
  telegram.props.onValueChange(true);
  assert.deepEqual(
    env.mutations.map((value) => JSON.parse(JSON.stringify(value))),
    [{ push_enabled: true }, { telegram_enabled: true }],
  );
  env.harness.unmount();
});
