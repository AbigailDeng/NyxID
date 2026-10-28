import assert from "node:assert/strict";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";
import { hookHarness } from "./assistantHookTestHarness";

test("private and crew message bodies are memoized and keep parser props stable across parent updates", () => {
  let colors = { textPrimary: "black", primaryOnTint: "purple" };
  const h = hookHarness<any>({
    "react/jsx-runtime": { jsx: (type: any, props: any) => ({ type, props }) },
    "react-native": { Text: "Text" },
    "react-native-markdown-display": {
      __esModule: true,
      default: "Markdown",
      MarkdownIt: () => ({}),
    },
    "expo-web-browser": {},
    "../../theme/ThemeContext": { useTheme: () => ({ colors }) },
    "./assistantSelectableMarkdown": {
      assistantSelectableMarkdown: { textgroup: "selectable" },
    },
  });
  const Body = h.load(
    fileURLToPath(new URL("./AssistantMarkdownBody.tsx", import.meta.url)),
  ).AssistantMarkdownBody as any;
  assert.equal(Body.$$typeof, Symbol.for("react.memo"));
  assert.equal(
    Body.compare,
    null,
    "React shallow comparison includes text, variant and the link handler",
  );
  for (const variant of ["private", "crew"]) {
    let text = "Saved reply";
    h.mount(() => Body.type({ text, variant }));
    const first = h.value();
    h.render();
    assert.equal(h.value().props.style, first.props.style);
    assert.equal(h.value().props.rules, first.props.rules);
    assert.equal(h.value().props.markdownit, first.props.markdownit);
    assert.equal(h.value().props.onLinkPress, first.props.onLinkPress);
    assert.equal(h.value().props.rules.textgroup, "selectable");
    text = "Updated stream";
    h.render();
    assert.equal(h.value().props.children, text);
    colors = { textPrimary: "white", primaryOnTint: "violet" };
    h.render();
    assert.equal(h.value().props.style.body.color, "white");
    assert.notEqual(h.value().props.style, first.props.style);
    h.unmount();
    colors = { textPrimary: "black", primaryOnTint: "purple" };
  }
});
