// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { useRef } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useFocusTrap } from "../useFocusTrap";

function Dialog({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active);
  return (
    <div ref={ref}>
      <button>first</button>
      <a href="#x">middle</a>
      <button>last</button>
    </div>
  );
}

afterEach(cleanup);

describe("useFocusTrap", () => {
  it("wraps Tab from last to first and Shift+Tab from first to last", () => {
    const { getByText } = render(<Dialog active />);
    const first = getByText("first");
    const last = getByText("last");

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("does not trap when inactive", () => {
    const { getByText } = render(<Dialog active={false} />);
    const last = getByText("last");
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(last);
  });

  it("restores the previously focused element when released", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    const { rerender, getByText } = render(<Dialog active />);
    getByText("first").focus();
    rerender(<Dialog active={false} />);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
