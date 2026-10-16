import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { hookHarness } from "../features/assistant/assistantHookTestHarness";

type Element = {
  type: any;
  key?: string;
  props: Record<string, any>;
};

function setup(iconUrl?: string | null) {
  const harness = hookHarness<Element>({
    "react/jsx-runtime": {
      jsx: (type: unknown, props: unknown, key?: string) => ({
        type,
        props,
        key,
      }),
    },
    "react-native": {
      Image: "Image",
      Text: "Text",
      View: "View",
      StyleSheet: { create: (styles: unknown) => styles },
    },
    "react-native-svg": { SvgUri: "SvgUri" },
    "../theme/ThemeContext": {
      useTheme: () => ({ colors: { ghostBg: "#eee", textSecondary: "#444" } }),
    },
    "../theme/designTokens": { fonts: {} },
  });
  const exports = harness.load(
    fileURLToPath(new URL("./ServiceIcon.tsx", import.meta.url)),
  );
  const props = { iconUrl, initial: "GH", color: "green" };
  harness.mount(() => exports.ServiceIcon(props));
  return { harness, props, source: exports.serviceIconSource };
}

test("database SVG endpoint is rendered as SVG despite having no file extension", () => {
  const url =
    "https://id.example/catalog-icons/60badfba-533c-4305-b9bb-c545186b06d0";
  const view = setup(url);
  const remote: Element = view.harness.value().props.children;
  view.harness.mount(() => remote.type(remote.props));
  const svg = view.harness.value();
  assert.equal(svg.type, "SvgUri");
  assert.equal(svg.props.uri, url);
  assert.equal(svg.props.width, 24);
  assert.equal(svg.props.height, 24);
  assert.equal(svg.props.headers, undefined);
  assert.equal(svg.props.fallback.props.children, "GH");
});

test("raster icons retain their aspect ratio and opaque SVG URLs can recover from native decoding failure", () => {
  const url = "https://assets.example/icon?id=123";
  const view = setup(url);
  const remote: Element = view.harness.value().props.children;
  view.harness.mount(() => remote.type(remote.props));
  const image = view.harness.value();
  assert.equal(image.type, "Image");
  assert.equal(image.props.source.uri, url);
  assert.equal(image.props.source.headers, undefined);
  assert.equal(image.props.resizeMode, "contain");
  image.props.onError();
  const svg = view.harness.flush();
  assert.equal(svg.type, "SvgUri");
  assert.equal(svg.props.uri, url);
  assert.equal(svg.props.fallback.props.children, "GH");
});

test("icon URLs are validated without allowing local files, credentials or executable schemes", () => {
  const view = setup();
  for (const invalid of [
    undefined,
    null,
    "",
    "not a URL",
    "/catalog-icons/id",
    "//assets.example/icon.svg",
    "file:///private/icon.svg",
    "data:image/svg+xml,<svg/>",
    "javascript:alert(1)",
    "https://user:password@assets.example/icon.png",
    "https://assets.example/icon.svg#fragment",
    `https://assets.example/${"a".repeat(2048)}`,
  ])
    assert.equal(view.source(invalid), null, String(invalid));
  assert.equal(view.source("http://localhost/catalog-icons/id").svg, true);
  assert.equal(view.source("https://assets.example/logo.SVG?v=2").svg, true);
  assert.equal(view.source("https://assets.example/logo.png").svg, false);
});

test("missing or invalid icons retain a decorative fallback without adding another accessibility stop", () => {
  for (const value of [undefined, null, "file:///icon.svg"]) {
    const view = setup(value);
    const tile = view.harness.value();
    assert.equal(tile.props.accessible, false);
    assert.equal(tile.props.accessibilityElementsHidden, true);
    assert.equal(tile.props.importantForAccessibility, "no-hide-descendants");
    assert.equal(tile.props.children.type, "Text");
    assert.equal(tile.props.children.props.children, "GH");
  }
});

test("a changed URL gets a fresh native loader and stable SVG callbacks avoid unnecessary refetches", () => {
  const view = setup("https://assets.example/first.svg");
  const first = view.harness.value().props.children;
  view.props.iconUrl = "https://assets.example/second.svg";
  const second = view.harness.render().props.children;
  assert.notEqual(first.key, second.key);
  view.harness.mount(() => first.type(first.props));
  const firstSvg = view.harness.value();
  view.harness.mount(() => second.type(second.props));
  const secondSvg = view.harness.value();
  assert.equal(firstSvg.props.onError, secondSvg.props.onError);
  assert.equal(secondSvg.props.uri, "https://assets.example/second.svg");
});
