import { expect, it } from "vitest";
import { nyxIdChatHistorySchema } from "./chat";

it("retains bounded voice request admission markers while rejecting private metadata", () => {
  const history = {
    conversation: {
      id: "nyxa-0123456789abcdef0123456789abcdef",
      activeTurn: false,
    },
    messages: [
      {
        id: "voice-message",
        seq: 1,
        turnId: "voice-task",
        role: "user",
        text: "查看日历",
        status: "completed",
        errorCode: null,
        requestId: "f985604b-1991-4aa2-969d-2325055ea813",
        executionPending: true,
      },
    ],
  };
  expect(nyxIdChatHistorySchema.parse(history)).toEqual(history);
  expect(() =>
    nyxIdChatHistorySchema.parse({
      ...history,
      messages: [
        { ...history.messages[0], providerToken: "must-not-cross-ipc" },
      ],
    }),
  ).toThrow();
  expect(() =>
    nyxIdChatHistorySchema.parse({
      ...history,
      messages: [{ ...history.messages[0], requestId: "bad" }],
    }),
  ).toThrow();
});
