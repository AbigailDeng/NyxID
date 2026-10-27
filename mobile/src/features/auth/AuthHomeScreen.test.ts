import assert from "node:assert/strict";
import { URL, fileURLToPath } from "node:url";
import test from "node:test";
import { MfaChallengeError } from "../../lib/auth/mfaChallenge";
import { ApiError } from "../../lib/api/ApiError";
import { deferred, hookHarness } from "../assistant/assistantHookTestHarness";
import type { PublicAuthConfig } from "./publicAuthConfig";
import * as emailLogin from "./emailLogin";
import * as publicAuthConfig from "./publicAuthConfig";
import * as socialCallback from "./socialCallback";

type Element = { type: unknown; props: Record<string, any> };
type LoginInput = ReturnType<typeof emailLogin.passwordLoginInput>;
type Session = {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt: number;
};
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const signedIn = {
  userId: "review-user",
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
  expiresIn: 3600,
};

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

function textContent(root: Element): string {
  return elements(root)
    .flatMap((element) => [element.props.children].flat(Infinity))
    .filter((child) => typeof child === "string")
    .join(" ");
}

function setup({
  state = "ready",
  providers = [],
}: {
  state?: "ready" | "loading" | "error";
  providers?: PublicAuthConfig["socialProviders"];
} = {}) {
  const config: PublicAuthConfig = {
    emailAuthEnabled: false,
    socialProviders: providers,
  };
  const calls: LoginInput[] = [];
  const sessions: Session[] = [];
  const socialUrls: string[] = [];
  let login = async (_input: LoginInput) => signedIn;
  let refetch = async () => ({ data: config, error: null as Error | null });
  let configRefetches = 0;
  const appStateListeners: Array<(state: string) => void> = [];
  const colors = new Proxy(
    { dangerTone: { bg: "#fee", border: "#f00" } },
    { get: (target, key) => Reflect.get(target, key) ?? "#111" },
  );
  const jsx = (type: unknown, props: Record<string, unknown>) => ({
    type,
    props,
  });
  const harness = hookHarness<Element>({
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "@expo/vector-icons/FontAwesome": { default: "FontAwesome" },
    "expo-web-browser": {
      openAuthSessionAsync: async (url: string) => {
        socialUrls.push(url);
        return { type: "cancel" };
      },
    },
    "@react-navigation/native": { useIsFocused: () => true },
    "@tanstack/react-query": {
      useQuery: () => ({
        data: state === "loading" ? undefined : config,
        isPending: state === "loading",
        isError: state === "error",
        isFetching: state === "loading",
        refetch: () => {
          configRefetches++;
          return refetch();
        },
      }),
    },
    "react-native": {
      ...Object.fromEntries(
        [
          "ActivityIndicator",
          "Pressable",
          "ScrollView",
          "Text",
          "TextInput",
          "View",
          "KeyboardAvoidingView",
        ].map((name) => [name, name]),
      ),
      Platform: { OS: "ios" },
      StyleSheet: { create: (styles: unknown) => styles },
      AppState: {
        currentState: "active",
        addEventListener: (
          _event: string,
          listener: (state: string) => void,
        ) => {
          appStateListeners.push(listener);
          return { remove: () => {} };
        },
      },
      Linking: {
        getInitialURL: async () => null,
        addEventListener: () => ({ remove: () => {} }),
      },
    },
    "react-native-svg": {
      default: "Svg",
      Path: "Path",
      Defs: "Defs",
      LinearGradient: "LinearGradient",
      Stop: "Stop",
    },
    "expo-linear-gradient": { LinearGradient: "ExpoLinearGradient" },
    "../../components/ScreenContainer": { ScreenContainer: "ScreenContainer" },
    "../../components/ToastOverlay": { ToastOverlay: "ToastOverlay" },
    "../../lib/auth/sessionStore": { authSessionGeneration: () => 0 },
    "../../lib/api/mobileApi": {
      mobileApi: {
        loginWithPassword: (input: LoginInput) => {
          calls.push(plain(input));
          return login(input);
        },
        verifyMfa: (body: {code: string; mfa_token: string}) => { calls.push({ mfaCode: body.code } as LoginInput); return Promise.resolve(signedIn); },
        getSocialAuthorizeUrl: (provider: string) =>
          `https://example.test/${provider}`,
      },
    },
    "../../lib/api/errorMessages": {
      resolveErrorMessage: (error: Error) => error.message,
    },
    "./AuthSessionContext": {
      useAuthSession: () => ({
        signInWithSession: async (session: Session) => {
          sessions.push(plain(session));
        },
      }),
    },
    "./emailLogin": emailLogin,
    "../../lib/api/publicAuthApi": { getPublicAuthConfig: async () => config },
    "./publicAuthConfig": publicAuthConfig,
    "./socialCallback": socialCallback,
    "../../lib/telemetry": { capture: () => {} },
    "../../theme/ThemeContext": { useTheme: () => ({ colors }) },
    "../../theme/flowStyles": { createFlowStyles: () => ({}) },
  });
  const { AuthHomeScreen } = harness.load(
    fileURLToPath(new URL("./AuthHomeScreen.tsx", import.meta.url)),
  ) as { AuthHomeScreen: (props: unknown) => Element };
  harness.mount(() => AuthHomeScreen({ navigation: { navigate: () => {} } }));

  function input(label: string) {
    const element = elements(harness.value()).find(
      (element) =>
        element.type === "TextInput" &&
        element.props.accessibilityLabel === label,
    );
    assert.ok(element, `Expected visible ${label} input`);
    return element;
  }
  function submit() {
    const element = elements(harness.value()).find(
      (element) =>
        element.type === "Pressable" &&
        /^(Sign In|Sign in|Verify & sign in|Signing in\.\.\.)$/.test(
          textContent(element),
        ),
    );
    assert.ok(element, "Expected email sign-in action");
    return element;
  }
  const social = () =>
    elements(harness.value()).filter(
      (element) => typeof element.props.provider === "string",
    );
  function change(label: string, value: string) {
    input(label).props.onChangeText(value);
    harness.flush();
  }
  return {
    harness,
    input,
    submit,
    social,
    change,
    calls,
    sessions,
    socialUrls,
    configRefetches: () => configRefetches,
    setLogin: (handler: typeof login) => {
      login = handler;
    },
    setRefetch: (handler: typeof refetch) => {
      refetch = handler;
    },
    background: () => {
      for (const listener of appStateListeners) listener("background");
      harness.flush();
    },
  };
}

for (const state of ["ready", "loading", "error"] as const) {
  test(`existing-account email login stays usable with ${state} social configuration`, async (t) => {
    const screen = setup({ state });
    t.after(screen.harness.unmount);
    assert.equal(screen.input("Password").props.secureTextEntry, true);
    assert.equal(screen.social().length, 0);
    assert.equal(screen.submit().props.disabled, true);
    screen.change("Email", " reviewer@example.test ");
    screen.change("Password", " review password ");
    assert.equal(screen.submit().props.disabled, false);
    const started = Date.now();
    screen.submit().props.onPress();
    await screen.harness.settle();
    assert.deepEqual(screen.calls, [
      {
        email: "reviewer@example.test",
        password: " review password ",
      },
    ]);
    assert.equal(screen.sessions.length, 1);
    assert.deepEqual(
      {
        accessToken: screen.sessions[0]!.accessToken,
        refreshToken: screen.sessions[0]!.refreshToken,
      },
      {
        accessToken: signedIn.accessToken,
        refreshToken: signedIn.refreshToken,
      },
    );
    assert.ok(screen.sessions[0]!.accessTokenExpiresAt >= started + 3_600_000);
    assert.ok(
      screen.sessions[0]!.accessTokenExpiresAt <= Date.now() + 3_600_000,
    );
    assert.equal(
      screen.configRefetches(),
      0,
      "Email does not wait for social discovery",
    );
  });
}

test("email authentication handles the actual MFA challenge before adopting a session", async (t) => {
  const screen = setup();
  t.after(screen.harness.unmount);
  screen.setLogin(async () => { throw new MfaChallengeError("synthetic-challenge"); });
  screen.change("Email", "reviewer@example.test");
  screen.change("Password", "password");
  screen.submit().props.onPress();
  await screen.harness.settle();
  assert.equal(screen.sessions.length, 0);
  assert.equal(screen.input("Authenticator code").props.value, "");
  assert.equal(screen.submit().props.disabled, true);
  screen.change("Authenticator code", "12");
  assert.equal(screen.submit().props.disabled, true);
  screen.change("Authenticator code", "012345");
  assert.equal(screen.submit().props.disabled, false);
  screen.submit().props.onPress();
  await screen.harness.settle();
  assert.deepEqual(screen.calls, [
    { email: "reviewer@example.test", password: "password" },
    { mfaCode: "012345" },
  ]);
  assert.equal(screen.sessions.length, 1);
});

test("failed credentials show feedback and permit retry without a false MFA prompt", async (t) => {
  const screen = setup();
  t.after(screen.harness.unmount);
  screen.setLogin(async () => {
    throw new ApiError({
      errorKey: "authentication_failed",
      errorCode: 2001,
      statusCode: 401,
      message: "Invalid email or password",
    });
  });
  screen.change("Email", "reviewer@example.test");
  screen.change("Password", "wrong-password");
  screen.submit().props.onPress();
  await screen.harness.settle();
  assert.match(
    textContent(screen.harness.value()),
    /Invalid email or password/,
  );
  assert.equal(screen.sessions.length, 0);
  assert.equal(
    elements(screen.harness.value()).some(
      (element) => element.props.accessibilityLabel === "Authenticator code",
    ),
    false,
  );
  screen.setLogin(async () => signedIn);
  screen.change("Password", "correct-password");
  screen.submit().props.onPress();
  await screen.harness.settle();
  assert.equal(screen.calls.length, 2);
  assert.equal(screen.sessions.length, 1);
});

test("a pending email attempt blocks duplicate presses and concurrent social login", async (t) => {
  const screen = setup({ providers: ["google"] });
  t.after(screen.harness.unmount);
  const pending = deferred<typeof signedIn>();
  screen.setLogin(() => pending.promise);
  screen.change("Email", "reviewer@example.test");
  screen.change("Password", "password");
  const staleSubmit = screen.submit().props.onPress;
  const staleSocial = screen.social()[0]!.props.onPress;
  staleSubmit();
  staleSubmit();
  staleSocial();
  screen.harness.flush();
  assert.equal(screen.calls.length, 1);
  assert.equal(screen.submit().props.disabled, true);
  assert.equal(screen.input("Email").props.editable, false);
  assert.equal(screen.social()[0]!.props.disabled, true);
  assert.equal(screen.configRefetches(), 0);
  assert.deepEqual(screen.socialUrls, []);
  pending.resolve(signedIn);
  await screen.harness.settle();
  assert.equal(screen.sessions.length, 1);
});

test("social login remains configured and revalidates availability before opening OAuth", async (t) => {
  const screen = setup({ providers: ["github"] });
  t.after(screen.harness.unmount);
  assert.deepEqual(
    screen.social().map((element) => element.props.provider),
    ["github"],
  );
  screen.setRefetch(async () => ({
    data: { emailAuthEnabled: false, socialProviders: [] },
    error: null,
  }));
  screen.social()[0]!.props.onPress();
  await screen.harness.settle();
  assert.equal(screen.configRefetches(), 1);
  assert.deepEqual(screen.socialUrls, []);
  assert.match(
    textContent(screen.harness.value()),
    /GitHub sign-in is not enabled/,
  );
  assert.equal(screen.input("Password").props.editable, true);
});

test("a pending social attempt blocks concurrent email login", async (t) => {
  const screen = setup({ providers: ["apple"] });
  t.after(screen.harness.unmount);
  const pending = deferred<{ data: PublicAuthConfig; error: Error | null }>();
  screen.setRefetch(() => pending.promise);
  screen.change("Email", "reviewer@example.test");
  screen.change("Password", "password");
  const staleSubmit = screen.submit().props.onPress;
  screen.social()[0]!.props.onPress();
  staleSubmit();
  screen.harness.flush();
  assert.equal(screen.submit().props.disabled, true);
  assert.equal(screen.input("Password").props.editable, false);
  assert.deepEqual(screen.calls, []);
  pending.resolve({
    data: { emailAuthEnabled: false, socialProviders: ["apple"] },
    error: null,
  });
  await screen.harness.settle();
  assert.equal(screen.socialUrls.length, 1);
  assert.equal(screen.submit().props.disabled, false);
});

test("backgrounding clears password and authenticator data", (t) => {
  const screen = setup();
  t.after(screen.harness.unmount);
  screen.change("Email", "reviewer@example.test");
  screen.change("Password", "password");
  screen.background();
  assert.equal(screen.input("Password").props.value, "");
  assert.equal(screen.input("Email").props.value, "reviewer@example.test");
  assert.equal(screen.submit().props.disabled, true);
});
