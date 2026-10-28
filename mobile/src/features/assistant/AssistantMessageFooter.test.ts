import assert from "node:assert/strict";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";
import { hookHarness } from "./assistantHookTestHarness";
import { messageTime } from "./messageTime";
import { canReplyFeedback } from "./assistantFeedback";
type E = { type: any; props: Record<string, any> };
const nodes = (n: any): E[] =>
  n?.props ? [n, ...[n.props.children].flat(Infinity).flatMap(nodes)] : [];
function expand(n: any): any {
  if (!n?.props) return n;
  if (typeof n.type === "function") return expand(n.type(n.props));
  return {
    ...n,
    props: {
      ...n.props,
      children: [n.props.children].flat(Infinity).map(expand),
    },
  };
}
function setup(props: any) {
  const modules = { copy: {}, feedback: {} };
  const alerts: any[] = [],
    saved: any[] = [],
    copied: string[] = [];
  const h = hookHarness<E>({
    "react/jsx-runtime": {
      jsx: (type: unknown, props: unknown) => ({ type, props }),
      jsxs: (type: unknown, props: unknown) => ({ type, props }),
    },
    "react-native": {
      ...Object.fromEntries(
        ["View", "Text", "Pressable", "Modal", "ScrollView"].map((n) => [n, n]),
      ),
      StyleSheet: { create: (v: unknown) => v },
      Alert: { alert: (...args: any[]) => alerts.push(args) },
    },
    "lucide-react-native": {
      Copy: "Copy",
      Check: "Check",
      ThumbsUp: "Up",
      ThumbsDown: "Down",
    },
    "expo-clipboard": {
      setStringAsync: async (text: string) => {
        copied.push(text);
        return true;
      },
    },
    "../../theme/ThemeContext": {
      useTheme: () => ({
        colors: {
          textMuted: "tertiary",
          primaryTone: {},
          successTone: { text: "success" },
          dangerTone: { text: "error" },
        },
      }),
    },
    "../../components/workspace/WorkspaceUI": Object.fromEntries(
      ["ActionButton", "Card", "Field", "Label"].map((n) => [n, n]),
    ),
    "./AssistantCopyButton": modules.copy,
    "./AssistantReplyFeedback": modules.feedback,
  });
  Object.assign(
    modules.copy,
    h.load(
      fileURLToPath(new URL("./AssistantCopyButton.tsx", import.meta.url)),
    ),
  );
  Object.assign(
    modules.feedback,
    h.load(
      fileURLToPath(new URL("./AssistantReplyFeedback.tsx", import.meta.url)),
    ),
  );
  const C = h.load(
    fileURLToPath(new URL("./AssistantMessageFooter.tsx", import.meta.url)),
  ).AssistantMessageFooter as any;
  const feedback = async (...args: any[]) => {
    saved.push(args);
    return true;
  };
  h.mount(() => expand(C({ onFeedback: feedback, ...props })));
  return { h, saved, copied, alerts, all: () => nodes(h.value()) };
}
test("reply footer has a single horizontal Copy/up/down/time row with icon-only 44pt controls", async () => {
  const x = setup({
    text: "A useful reply",
    timestamp: "2026-10-27T01:00:00Z",
  });
  const all = x.all();
  const controls = all.filter((n) => n.type === "Pressable");
  assert.deepEqual(
    controls.map((n) => n.props.accessibilityLabel).slice(0, 3),
    ["Copy message", "Helpful", "Not helpful"],
  );
  const row = x.h.value().props.children[0];
  assert.equal(row.props.style.flexDirection, "row");
  assert.equal(row.props.children[0].props.accessibilityLabel, "Copy message");
  assert.equal(
    row.props.children[1].props.accessibilityLabel,
    "Reply feedback",
  );
  assert.equal(row.props.children[2].props.accessibilityRole, "text");
  assert.equal(all.filter((n) => n.type === "Text").length, 1);
  const stamp = all.find((n) => n.type === "Text")!;
  assert.equal(stamp.props.style[0].fontSize, 11);
  assert.equal(stamp.props.style[1].color, "tertiary");
  for (const control of controls.slice(0, 3)) {
    const style =
      typeof control.props.style === "function"
        ? control.props.style({ pressed: false })[0]
        : control.props.style;
    assert.ok((style.width ?? style.minWidth) >= 44);
    assert.ok((style.height ?? style.minHeight) >= 44);
  }
  assert.ok(
    all.some(
      (n) =>
        n.type === "Copy" &&
        n.props.size === 16 &&
        n.props.color === "tertiary",
    ),
  );
  assert.equal(all.find((n) => n.type === "Modal")!.props.visible, false);
  controls[0]!.props.onPress();
  await x.h.settle();
  assert.deepEqual(x.copied, ["A useful reply"]);
  assert.ok(x.all().some((n) => n.props.accessibilityLabel === "Copied"));
  controls[3]!.props.onLongPress();
  assert.match(x.alerts[0][1], /2026/);
  x.h.unmount();
});
test("feedback details appear after the vote; selected success/error tones and withdrawal match web", async () => {
  const x = setup({ text: "Reply" });
  const press = (label: string) => {
    x.all()
      .find((n) => n.props.accessibilityLabel === label)!
      .props.onPress();
    x.h.flush();
  };
  press("Helpful");
  await x.h.settle();
  assert.equal(x.saved[0][0], "up");
  assert.equal(x.all().find((n) => n.type === "Modal")!.props.visible, true);
  assert.ok(
    x.all().some((n) => n.type === "Up" && n.props.color === "success"),
  );
  press("Helpful");
  await x.h.settle();
  assert.equal(x.saved[1][0], undefined);
  assert.equal(x.all().find((n) => n.type === "Modal")!.props.visible, false);
  press("Not helpful");
  await x.h.settle();
  assert.ok(
    x.all().some((n) => n.type === "Down" && n.props.color === "error"),
  );
  x.h.unmount();
});
test("human footer preserves time-before-Copy order; crew agent actions omit duplicated attribution time", () => {
  const user = setup({
    user: true,
    text: "Human",
    timestamp: "2026-10-27T01:00:00Z",
  });
  assert.equal(
    user.h.value().props.children[0].props.accessibilityRole,
    "text",
  );
  assert.equal(
    user.h.value().props.children[1].props.accessibilityLabel,
    "Copy message",
  );
  user.h.unmount();
  const crew = setup({ text: "Crew agent" });
  assert.ok(!crew.all().some((n) => n.props.accessibilityRole === "text"));
  assert.ok(crew.all().some((n) => n.props.accessibilityLabel === "Helpful"));
  crew.h.unmount();
});
test("feedback eligibility excludes replay, legacy, failed, stopped, system and continuation rows", () => {
  const id = `nyxa-${"a".repeat(32)}`;
  const message = {
    role: "assistant",
    status: "completed",
    error_code: null,
    text: "Reply",
  };
  assert.equal(canReplyFeedback(message, id), true);
  assert.equal(canReplyFeedback(message, id, true), false);
  for (const parent of [undefined, "legacy-thread"])
    assert.equal(canReplyFeedback(message, parent), false);
  for (const patch of [
    { status: "failed" },
    { error_code: "cancelled" },
    { role: "orchestrator" },
    { text: " " },
    { continuation_of: "decision" },
  ])
    assert.equal(canReplyFeedback({ ...message, ...patch }, id), false);
});
test("message-time parity: local calendar day/month/year, locale and full daylight-saving time labels", () => {
  const now = Date.parse("2026-10-28T04:00:00Z");
  const short = (value: string, timeZone: string, locale = "en-US") =>
    messageTime(value, { locale, timeZone, now })?.short;
  assert.equal(short("2026-10-27T00:04:00Z", "Asia/Singapore"), "27 Oct");
  assert.equal(short("2025-10-27T00:04:00Z", "Asia/Singapore"), "27 Oct 2025");
  assert.equal(short("2026-12-31T16:00:00Z", "UTC"), "31 Dec");
  assert.equal(short("2026-12-31T16:00:00Z", "Asia/Tokyo"), "1 Jan 2027");
  assert.equal(
    short("2026-10-27T00:04:00Z", "Asia/Shanghai", "zh-CN"),
    "10月27日",
  );
  const options = { locale: "en-US", timeZone: "America/New_York", now };
  assert.match(
    messageTime("2026-11-01T05:30:00Z", options)!.label,
    /1:30 AM EDT/,
  );
  assert.match(
    messageTime("2026-11-01T06:30:00Z", options)!.label,
    /1:30 AM EST/,
  );
  assert.equal(
    messageTime(Date.parse("2026-10-27T00:04:00Z"), options)!.iso,
    "2026-10-27T00:04:00.000Z",
  );
  for (const invalid of [undefined, null, "", "invalid", NaN])
    assert.equal(messageTime(invalid), undefined);
});
