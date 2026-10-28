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
