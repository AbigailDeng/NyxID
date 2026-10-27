import { useRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useScrollFades } from "./use-scroll-fades";

let frames: Map<number, FrameRequestCallback>;
let resize: ResizeObserverCallback;
let disconnect: ReturnType<typeof vi.fn>;
let nextFrame: number;

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  disconnect = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = disconnect;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function flush() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
}
function measure(element: HTMLElement, height: number, width = 100) {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: height },
    clientWidth: { configurable: true, value: 100 },
    scrollWidth: { configurable: true, value: width },
  });
}
function Fixture() {
  const root = useRef<HTMLDivElement>(null);
  useScrollFades(root);
  return (
    <div ref={root} data-testid="root">
      <nav
        data-testid="list"
        data-scroll-fade="overlay"
        ref={(node) => {
          if (node) measure(node, 300, 200);
        }}
      >
        <div>Agents</div>
      </nav>
    </div>
  );
}

it("marks only edges with hidden content at the start, middle and end, including pixel tolerance", () => {
  const { getByTestId } = render(<Fixture />);
  const list = getByTestId("list");
  expect(list.dataset.scrollEdges).toBe("bottom right");
  list.scrollTop = 60;
  list.scrollLeft = 30;
  fireEvent.scroll(list);
  expect(list.dataset.scrollEdges).toBe("top bottom left right");
  list.scrollTop = 199.5;
  list.scrollLeft = 99.5;
  fireEvent.scroll(list);
  expect(list.dataset.scrollEdges).toBe("top left");
  list.scrollTop = 0.5;
  list.scrollLeft = 0.5;
  fireEvent.scroll(list);
  expect(list.dataset.scrollEdges).toBe("bottom right");
});

it("clears fades when content fits after resize or collapse without changing scroll position", () => {
  const { getByTestId } = render(<Fixture />);
  const list = getByTestId("list");
  measure(list, 100);
  act(() => resize([], {} as ResizeObserver));
  flush();
  expect(list.dataset.scrollEdges).toBe("");
  measure(list, 400);
  list.scrollTop = 80;
  act(() => resize([], {} as ResizeObserver));
  flush();
  expect(list.dataset.scrollEdges).toBe("top bottom");
  expect(list.scrollTop).toBe(80);
});

it("discovers newly mounted scroll regions and detaches its observers and scheduled work", async () => {
  const { getByTestId, unmount } = render(<Fixture />);
  const extra = document.createElement("div");
  extra.dataset.scrollFade = "";
  measure(extra, 220);
  await act(async () => {
    getByTestId("root").append(extra);
  });
  flush();
  expect(extra.dataset.scrollEdges).toBe("bottom");
  fireEvent.resize(window);
  expect(frames.size).toBe(1);
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  extra.scrollTop = 50;
  fireEvent.scroll(extra);
  expect(extra.dataset.scrollEdges).toBe("bottom");
});
