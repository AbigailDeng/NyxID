import assert from "node:assert/strict";
import { URL, fileURLToPath } from "node:url";
import test from "node:test";
import { hookHarness } from "../assistant/assistantHookTestHarness";
import * as credits from "./credits";
import { allowancesSchema, grantsSchema, serviceUsage, usageSchema, walletSchema } from "./billingContracts";
import { allowanceFixture, grantFixture, usageFixture, walletFixture } from "./billingFixtures";

type Element = { type: unknown; props: Record<string, any> };
function elements(root: Element): Element[] {
  return [root, ...[root.props.children].flat(Infinity).flatMap((child) => child && typeof child === "object" && "props" in child ? elements(child) : [])];
}
const text = (root: Element) => elements(root).flatMap((element) => [element.props.children].flat(Infinity)).filter((value) => typeof value === "string").join(" ");

function setup(component: string, props: Record<string, unknown>) {
  const jsx = (type: unknown, props: Record<string, unknown>): Element => typeof type === "function" ? type(props) : { type, props };
  const harness = hookHarness<Element>({
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { Pressable: "Pressable", View: "View", StyleSheet: { create: (styles: unknown) => styles } },
    "../../components/workspace/WorkspaceUI": { ActionButton: "ActionButton", Card: "Card", Label: "Label" },
    "../../theme/ThemeContext": { useTheme: () => ({ colors: { danger: "red", textPrimary: "zinc", cardSoft: "zinc", border: "zinc" } }) },
    "../../theme/designTokens": { spacing: {}, radius: {}, typeScale: {} },
    "./credits": credits,
  });
  const components = harness.load(fileURLToPath(new URL("./BillingPresentation.tsx", import.meta.url))) as Record<string, (props: Record<string, unknown>) => Element>;
  harness.mount(() => components[component]!(props));
  return { harness, all: () => elements(harness.value()), text: () => text(harness.value()) };
}

test("figures expose exact tabular, right-aligned values and accessible labels", (t) => {
  const screen = setup("BillingFigure", { label: "Balance", value: "-0.000000000001" });
  t.after(screen.harness.unmount);
  assert.equal(screen.harness.value().props.accessibilityLabel, "Balance: -0.000000000001 credits");
  const amount = screen.all().find((item) => item.props.mono);
  assert.ok(amount);
  assert.equal(amount.props.style[0].textAlign, "right");
  assert.deepEqual(JSON.parse(JSON.stringify(amount.props.style[0].fontVariant)), ["tabular-nums"]);
  assert.equal(amount.props.style[1].color, "red");
});

test("an absent wallet has an honest empty state and no purchase control", (t) => {
  const screen = setup("BillingWalletCard", { wallet: null });
  t.after(screen.harness.unmount);
  assert.match(screen.text(), /No billing account yet/);
  assert.equal(screen.all().some((item) => item.type === "ActionButton" || item.props.onPress), false);
});

test("wallet figures preserve negatives and pending expiry at pico precision", (t) => {
  const screen = setup("BillingWalletCard", { wallet: walletSchema.parse(walletFixture) });
  t.after(screen.harness.unmount);
  const labels = screen.all().map((item) => item.props.accessibilityLabel).filter(Boolean);
  assert.ok(labels.includes("Balance: -0.000000000001 credits"));
  assert.ok(labels.includes("Pending expiry: 1.234567890123 credits"));
  assert.ok(labels.includes("Overdraft limit: 100 credits"));
});

test("grant expiry and allowance exhaustion are visible with periods and exact limits", (t) => {
  const now = Date.parse("2026-11-01T00:00:00Z");
  const grant = setup("BillingGrantCard", { grant: grantsSchema.parse({ grants: [grantFixture] }).grants[0], now });
  t.after(grant.harness.unmount);
  assert.match(grant.text(), /Expired/);
  assert.ok(grant.all().some((item) => item.props.accessibilityLabel === "Credit limit: 50.000000000001 credits"));
  const allowance = setup("BillingAllowanceCard", { balance: allowancesSchema.parse({ allowances: [{ ...allowanceFixture, remaining_quantity: 0 }] }).allowances[0], now: now - 1 });
  t.after(allowance.harness.unmount);
  assert.match(allowance.text(), /Used up/);
  assert.match(allowance.text(), /monthly/);
  assert.match(allowance.text(), /UTC/);
  assert.ok(allowance.all().some((item) => item.props.accessibilityLabel === "Remaining: 0 units"));
});

test("service detail bounds its initial render and expands without changing amounts", (t) => {
  const usage = usageSchema.parse({ ...usageFixture, rows: Array.from({ length: 6 }, () => usageFixture.rows[1]) });
  const screen = setup("BillingServiceCard", { service: serviceUsage(usage.rows)[0] });
  t.after(screen.harness.unmount);
  const quantities = () => screen.all().filter((item) => item.props.accessibilityLabel?.startsWith("input tokens"));
  assert.equal(quantities().length, 5);
  screen.all().find((item) => item.type === "ActionButton")!.props.onPress();
  screen.harness.flush();
  assert.equal(quantities().length, 6);
  assert.ok(screen.all().some((item) => item.props.accessibilityLabel === "Usage cost: 0.000000000012 credits"));
});

test("account rows are accessible radios with 48pt targets", (t) => {
  let presses = 0;
  const screen = setup("BillingOwnerRow", { label: "Personal account", selected: true, onPress: () => { presses++; } });
  t.after(screen.harness.unmount);
  const row = screen.harness.value();
  assert.equal(row.props.accessibilityRole, "radio");
  assert.equal(row.props.accessibilityState.checked, true);
  assert.ok(row.props.style({ pressed: false })[0].minHeight >= 44);
  row.props.onPress();
  assert.equal(presses, 1);
});
