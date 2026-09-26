// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { ChartTooltip } from "../ChartTooltip";

afterEach(cleanup);

function container(top: number, left: number) {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({ top, left } as DOMRect);
  return { current: el };
}

describe("ChartTooltip", () => {
  it("renders nothing on the server", () => {
    expect(renderToString(<ChartTooltip top={1} left={2}>tip</ChartTooltip>)).toBe("");
  });

  it("portals to body at container-relative fixed coordinates and follows prop changes", () => {
    const ref = container(100, 50);
    const { rerender } = render(
      <ChartTooltip top={10} left={5} containerRef={ref}>tip</ChartTooltip>,
    );
    const tip = document.body.lastElementChild as HTMLElement;
    expect(tip.textContent).toBe("tip");
    expect(tip.style.top).toBe("110px");
    expect(tip.style.left).toBe("55px");

    rerender(<ChartTooltip top={20} left={30} containerRef={ref}>tip</ChartTooltip>);
    expect(tip.style.top).toBe("120px");
    expect(tip.style.left).toBe("80px");
  });

  it("uses the raw coordinates without a container", () => {
    render(<ChartTooltip top={7} left={9}>tip</ChartTooltip>);
    const tip = document.body.lastElementChild as HTMLElement;
    expect(tip.style.top).toBe("7px");
    expect(tip.style.left).toBe("9px");
  });
});
