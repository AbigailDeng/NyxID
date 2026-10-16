import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { hookHarness } from "./assistantHookTestHarness";
import type { AssistantMentionOption } from "./AssistantMentionInput";

type Element = {
  type: unknown;
  key?: unknown;
  props: Record<string, any>;
};

const options: AssistantMentionOption[] = [
  {
    id: "report",
    handle: "file-1",
    label: "Quarterly report.pdf",
    kind: "file",
  },
  { id: "photo", handle: "image-1", label: "Office photo", kind: "image" },
  {
    id: "research",
    handle: "research",
    label: "Research helper",
    kind: "agent",
  },
];

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

function setup(initial: Record<string, unknown> = {}) {
  const writes: string[] = [];
  const props: Record<string, any> = {
    value: "",
    onChangeText: (text: string) => {
      writes.push(text);
      props.value = text;
    },
    mentions: options,
    editable: true,
    placeholder: "Message",
    accessibilityLabel: "Message",
    generation: 0,
    ...initial,
  };
  const harness = hookHarness<Element>({
    "react/jsx-runtime": {
      jsx: (type: unknown, props: unknown, key?: unknown) => ({
        type,
        props,
        key,
      }),
      jsxs: (type: unknown, props: unknown, key?: unknown) => ({
        type,
        props,
        key,
      }),
    },
    "react-native": {
      Pressable: "Pressable",
      ScrollView: "ScrollView",
      Text: "Text",
      TextInput: "TextInput",
      View: "View",
      StyleSheet: { create: (styles: unknown) => styles },
    },
    "lucide-react-native": {
      Bot: "Bot",
      Clipboard: "Clipboard",
      FileText: "FileText",
      Image: "Image",
    },
    "../../theme/ThemeContext": { useTheme: () => ({ colors: {} }) },
    "../../theme/designTokens": { fonts: {} },
  });
  const component = harness.load(
    fileURLToPath(new URL("./AssistantMentionInput.tsx", import.meta.url)),
  ).AssistantMentionInput as (props: any) => Element;
  harness.mount(() => component(props));
  const all = () => elements(harness.flush());
  const input = () => {
    const result = all().find((element) => element.type === "TextInput");
    assert.ok(result);
    return result;
  };
  const button = () => {
    const result = all().find(
      (element) =>
        element.props.accessibilityLabel === "Mention an attachment or agent",
    );
    assert.ok(result);
    return result;
  };
  const candidates = () =>
    all().filter(
      (element) =>
        element.props.accessibilityLabel?.startsWith("Mention ") &&
        element.props.accessibilityLabel !== "Mention an attachment or agent",
    );
  const select = (start: number, end = start) => {
    input().props.onSelectionChange({
      nativeEvent: { selection: { start, end } },
    });
    harness.flush();
  };
  const focus = () => {
    input().props.onFocus();
    harness.flush();
  };
  const choose = (handle: string) => {
    const result = candidates().find((element) =>
      element.props.accessibilityLabel.endsWith(`@${handle}`),
    );
    assert.ok(result, `Expected @${handle} candidate`);
    result.props.onPress();
    harness.render();
  };
  return {
    props,
    writes,
    harness,
    input,
    button,
    candidates,
    select,
    focus,
    choose,
  };
}

test("typing a mention searches options and replaces its full handle at the native caret", () => {
  const view = setup({ value: "Please @fi-le later" });
  view.focus();
  view.select(10);
  assert.deepEqual(
    view.candidates().map((element) => element.props.accessibilityLabel),
    ["Mention Quarterly report.pdf, @file-1", "Mention Office photo, @image-1"],
  );
  view.choose("file-1");
  assert.equal(view.props.value, "Please @file-1 later");
  assert.equal(view.input().props.selection.start, "Please @file-1 ".length);
  assert.equal(view.input().props.selection.end, "Please @file-1 ".length);
  assert.equal(view.candidates().length, 0);
});

test("the @ button preserves text on both sides of a caret inside a word", () => {
  const view = setup({ value: "helloworld" });
  view.focus();
  view.select(5);
  view.button().props.onPress();
  view.harness.render();
  assert.equal(view.props.value, "hello @ world");
  view.choose("file-1");
  assert.equal(view.props.value, "hello @file-1 world");
});

test("selected text suppresses autocomplete and the @ button preserves that selection", () => {
  const view = setup({ value: "@file-1 tail" });
  view.focus();
  view.select(0, 7);
  assert.equal(view.candidates().length, 0);
  view.button().props.onPress();
  view.harness.render();
  assert.equal(view.props.value, "@file-1 @ tail");
  view.choose("image-1");
  assert.equal(view.props.value, "@file-1 @image-1 tail");
});

test("native typing and IME updates do not force a controlled cursor or remount the input", () => {
  const view = setup();
  const key = view.input().key;
  for (const text of ["n", "ni", "你", "你好", ""]) {
    view.input().props.onChangeText(text);
    view.harness.render();
    assert.equal(view.input().key, key);
    assert.equal(view.input().props.selection, undefined);
  }
  assert.deepEqual(view.writes, ["n", "ni", "你", "你好", ""]);
});

test("a private composer has no mention action or suggestions and keeps typed @ text intact", () => {
  const view = setup({ mentions: undefined });
  view.focus();
  view.input().props.onChangeText("Please check @file-1");
  view.harness.render();
  view.select("Please check @file-1".length);
  assert.equal(view.props.value, "Please check @file-1");
  assert.equal(view.candidates().length, 0);
  assert.equal(
    elements(view.harness.value()).some(
      (element) => element.type === "Pressable",
    ),
    false,
  );
});

test("generation changes fence old text, selection and suggestion handlers", () => {
  const view = setup({ value: "@fi" });
  view.focus();
  view.select(3);
  const oldInput = view.input();
  const oldSuggestion = view.candidates()[0];
  assert.ok(oldSuggestion);
  view.props.generation = 1;
  view.props.value = "";
  view.harness.render();
  assert.notEqual(view.input().key, oldInput.key);
  oldInput.props.onChangeText("old composing text");
  oldInput.props.onSelectionChange({
    nativeEvent: { selection: { start: 3, end: 3 } },
  });
  oldSuggestion.props.onPress();
  view.harness.flush();
  assert.equal(view.props.value, "");
  assert.deepEqual(view.writes, []);
  view.input().props.onChangeText("新");
  view.harness.render();
  assert.equal(view.props.value, "新");
});

test("an external send/clear fences delayed native edits even without a generation change", () => {
  const view = setup({ value: "sent message" });
  const oldInput = view.input();
  view.props.value = "";
  view.harness.render();
  assert.notEqual(view.input().key, oldInput.key);
  oldInput.props.onChangeText("sent message restored by stale IME event");
  view.harness.flush();
  assert.equal(view.props.value, "");
  assert.deepEqual(view.writes, []);
});

test("disabled and unmounted composers ignore retained native callbacks", () => {
  const view = setup({ value: "@fi" });
  view.focus();
  view.select(3);
  const prior = view.input();
  const suggestion = view.candidates()[0];
  view.props.editable = false;
  view.harness.render();
  assert.equal(view.button().props.disabled, true);
  assert.equal(view.candidates().length, 0);
  prior.props.onChangeText("blocked");
  suggestion.props.onPress();
  assert.deepEqual(view.writes, []);
  view.props.editable = true;
  view.harness.render();
  const current = view.input();
  view.harness.unmount();
  current.props.onChangeText("after unmount");
  current.props.onBlur();
  assert.deepEqual(view.writes, []);
});
