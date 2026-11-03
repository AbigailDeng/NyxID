import { expect, it } from "vitest";
import { parseAutomationSearch } from "./automation-search";

it("retains bounded automation identity and explicit creation state for native Web handoffs", () => {
  const automation = "a91c328b-0acd-4d91-9c99-b45e7f328e8c";
  expect(
    parseAutomationSearch({
      automation,
      agent: "researcher",
      create: "true",
      token: "secret",
      return_to: "https://elsewhere.test",
    }),
  ).toEqual({ automation, agent: "researcher", create: true });
  for (const automation of [
    "wrong",
    "------------------------------------",
    "x".repeat(256),
    123,
  ])
    expect(parseAutomationSearch({ automation, create: "yes" })).toEqual({});
});
