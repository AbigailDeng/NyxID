import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { hookHarness } from "../../features/assistant/assistantHookTestHarness";
test("nested drawer headers keep Back/title/Close in a left-aligned 18pt row", () => {
  const h = hookHarness<any>({
    "react/jsx-runtime": {
      jsx: (type: any, props: any) => ({ type, props }),
      jsxs: (type: any, props: any) => ({ type, props }),
    },
    "react-native": {
      View: "View",
      Text: "Text",
      StyleSheet: { create: (v: any) => v },
    },
    "../../theme/ThemeContext": { useTheme: () => ({ colors: {} }) },
  });
  const Header = h.load(
    fileURLToPath(new URL("./WorkspaceDrawerHeader.tsx", import.meta.url)),
  ).WorkspaceDrawerHeader as any;
  h.mount(() =>
    Header({
      back: {},
      route: { name: "UsageCredits" },
      options: {
        title: "Usage & credits",
        headerLeft: () => "Back",
        headerRight: () => "Close",
      },
    }),
  );
  const [back, title, close] = h.value().props.children;
  assert.equal(back, "Back");
  assert.equal(close, "Close");
  assert.equal(title.props.children, "Usage & credits");
  assert.equal(title.props.style[0].fontSize, 18);
  assert.equal(title.props.style[0].flex, 1);
  assert.equal(title.props.numberOfLines, 1);
  h.unmount();
  const source = readFileSync(
    fileURLToPath(new URL("../../app/AppNavigator.tsx", import.meta.url)),
    "utf8",
  );
  const drawer = source.slice(
    source.indexOf("<SheetStack.Navigator"),
    source.indexOf("</SheetStack.Navigator>"),
  );
  const defaults = drawer.slice(0, drawer.indexOf("<SheetStack.Screen"));
  assert.match(defaults, /header: WorkspaceDrawerHeader/);
  assert.match(
    drawer,
    /name="UsageCredits"[\s\S]*?header: WorkspaceDrawerHeader/,
  );
  for (const override of drawer.matchAll(/header:\s*(\w+)/g))
    assert.equal(override[1], "WorkspaceDrawerHeader");
});
