import assert from "node:assert/strict";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";
import { hookHarness } from "../../features/assistant/assistantHookTestHarness";
type E = { type: unknown; props: Record<string, any> };
const nodes = (n: any): E[] =>
  n?.props ? [n, ...[n.props.children].flat(Infinity).flatMap(nodes)] : [];
function setup() {
  const events: string[] = [];
  const h = hookHarness<E>({
    "react/jsx-runtime": {
      jsx: (type: unknown, props: unknown) => ({ type, props }),
      jsxs: (type: unknown, props: unknown) => ({ type, props }),
    },
    "react-native": {
      Text: "Text",
      View: "View",
      Pressable: "Pressable",
      StyleSheet: { create: (v: unknown) => v },
      findNodeHandle: () => 1,
    },
    "react-native-safe-area-context": {
      SafeAreaView: "Safe",
      useSafeAreaInsets: () => ({ bottom: 0 }),
    },
    "lucide-react-native": Object.fromEntries(
      [
        "Bot",
        "CalendarClock",
        "ChevronRight",
        "KeyRound",
        "MessageSquare",
        "Monitor",
        "Plug",
        "ScanQrCode",
        "ShieldCheck",
        "X",
        "WalletCards",
      ].map((n) => [n, n]),
    ),
    "@tanstack/react-query": {
      useQuery: () => ({ data: { display_name: "UI Review" } }),
    },
    "../../lib/api/http": {},
    "../../theme/ThemeContext": { useTheme: () => ({ colors: {} }) },
    "../brand/NyxidLogo": { NyxidLogo: "Logo" },
    "./WorkspaceChatList": { WorkspaceChatList: "ChatList" },
    "./WorkspaceDrawerModal": { WorkspaceDrawerModal: "Modal" },
    "./ScrollEdgeFades": {
      ScrollEdgeFades: "Fades",
      useScrollEdges: () => ({ edges: {} }),
    },
  });
  const Drawer = h.load(
    fileURLToPath(new URL("./WorkspaceDrawer.tsx", import.meta.url)),
  ).WorkspaceDrawer as any;
  h.mount(() =>
    Drawer({
      visible: true,
      onHome: () => events.push("home"),
      onClose: () => events.push("close"),
      onNavigate: (name: string) => events.push(name),
      onUsageCredits: () => events.push("usage"),
    }),
  );
  const all = () => [
    ...nodes(h.value()),
    ...nodes(
      nodes(h.value()).find((n) => n.type === "ChatList")!.props.scrollHeader,
    ),
  ];
  return { h, events, all };
}
test("side-menu logo is an accessible home target, independent from Close; Chats routes to Assistant", () => {
  const x = setup();
  const home = x
    .all()
    .find((n) => n.props.accessibilityLabel === "NyxID home")!;
  assert.equal(home.props.accessibilityRole, "button");
  assert.equal(home.props.style.minHeight, 44);
  home.props.onPress();
  const chats = x.all().find((n) => n.props.accessibilityLabel === "Chats")!;
  chats.props.onPress();
  x.all()
    .find((n) => n.props.accessibilityLabel === "Close navigation")!
    .props.onPress();
  assert.deepEqual(x.events, ["home", "Assistant", "close"]);
  x.h.unmount();
});

test("side-menu Close shares the drawer circle and account footer chevrons stay at the trailing edge", () => {
  const x = setup();
  const close = x
    .all()
    .find((n) => n.props.accessibilityLabel === "Close navigation")!;
  assert.equal(close.props.style.width, 44);
  assert.equal(close.props.style.height, 44);
  assert.equal(close.props.style.borderRadius, 22);
  assert.equal(nodes(close).find((n) => n.type === "X")?.props.size, 22);
  const usage = x
    .all()
    .find((n) => n.props.accessibilityLabel === "Open usage and credits")!;
  const style = Object.assign({}, ...usage.props.style({ pressed: false }));
  assert.equal(style.minHeight, 62);
  assert.equal(style.gap, 12);
  const label = nodes(usage).find((n) => n.type === "Text")!;
  assert.equal(label.props.style[1].flex, 1);
  assert.equal(label.props.numberOfLines, 1);
  const account = x
    .all()
    .find((n) => n.props.accessibilityLabel === "Open account settings")!;
  const last = (n: E) => [n.props.children].flat(Infinity).at(-1);
  assert.equal(last(usage).type, "ChevronRight");
  assert.equal(last(account).type, "ChevronRight");
  assert.equal(last(usage).props.size, last(account).props.size);
  usage.props.onPress();
  assert.deepEqual(x.events, ["usage"]);
  x.h.unmount();
});
