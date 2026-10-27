import assert from "node:assert/strict";
import test from "node:test";
import {
  composerHeightLimit,
  defaultChatLayout,
  normalizeChatLayout,
  offersChatWidth,
} from "./chatLayout";

test("missing or corrupt device-local layout values retain native defaults", () => {
  for (const value of [
    null,
    undefined,
    "bad",
    [],
    { columnWidth: NaN, composerMaxHeight: "300" },
    { columnWidth: Infinity, composerMaxHeight: -Infinity },
  ])
    assert.deepEqual(normalizeChatLayout(value), defaultChatLayout);
  assert.deepEqual(
    normalizeChatLayout({ columnWidth: 10, composerMaxHeight: 9999 }),
    { columnWidth: 360, composerMaxHeight: 320 },
  );
});
test("composer maximum caps to short keyboard windows without forcing height", () => {
  assert.equal(composerHeightLimit(120, 844), 120);
  assert.equal(composerHeightLimit(320, 390), 92);
  assert.equal(composerHeightLimit(320, 260), 44);
  assert.equal(
    composerHeightLimit(120, 844),
    defaultChatLayout.composerMaxHeight,
  );
  assert.equal(offersChatWidth(393), false);
  assert.equal(offersChatWidth(600), true);
});
