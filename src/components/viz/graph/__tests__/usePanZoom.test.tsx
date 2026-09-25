// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { usePanZoom } from "../usePanZoom";
import type { ViewTransform } from "../types";

afterEach(cleanup);

interface Props {
  viewTransform?: ViewTransform;
  onViewTransformChange?: (vt: ViewTransform) => void;
  onWheel?: () => void;
  onPanStart?: () => void;
}

function Canvas(props: Props) {
  const { svgRef, wrapperRef } = usePanZoom(props);
  return (
    <div ref={wrapperRef} data-testid="wrapper">
      <svg ref={svgRef} data-testid="svg" />
    </div>
  );
}

function touch(x: number, y: number) {
  return { clientX: x, clientY: y } as Touch;
}

describe("usePanZoom", () => {
  it("wheel-zooms from the latest view transform and calls the latest onWheel", () => {
    const onChange = vi.fn();
    const firstWheel = vi.fn();
    const latestWheel = vi.fn();
    const { rerender, getByTestId } = render(
      <Canvas viewTransform={{ x: 0, y: 0, scale: 1 }} onViewTransformChange={onChange} onWheel={firstWheel} />,
    );
    rerender(
      <Canvas viewTransform={{ x: 10, y: 20, scale: 2 }} onViewTransformChange={onChange} onWheel={latestWheel} />,
    );

    fireEvent.wheel(getByTestId("svg"), { deltaY: -1, clientX: 0, clientY: 0 });

    // Zoom in by 1.1 around (0,0) from scale 2 at (10,20).
    const vt = onChange.mock.calls[0]![0] as ViewTransform;
    expect(vt.scale).toBeCloseTo(2.2);
    expect(vt.x).toBeCloseTo(11);
    expect(vt.y).toBeCloseTo(22);
    expect(latestWheel).toHaveBeenCalledTimes(1);
    expect(firstWheel).not.toHaveBeenCalled();
  });

  it("ignores wheel events outside transform mode", () => {
    const onChange = vi.fn();
    const { getByTestId } = render(<Canvas onViewTransformChange={onChange} />);
    fireEvent.wheel(getByTestId("svg"), { deltaY: -1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("single-finger drag past the threshold pans and calls the latest onPanStart", () => {
    const onChange = vi.fn();
    const firstPan = vi.fn();
    const latestPan = vi.fn();
    const vt = { x: 5, y: 5, scale: 1 };
    const { rerender, getByTestId } = render(
      <Canvas viewTransform={vt} onViewTransformChange={onChange} onPanStart={firstPan} />,
    );
    rerender(<Canvas viewTransform={vt} onViewTransformChange={onChange} onPanStart={latestPan} />);

    const el = getByTestId("wrapper");
    fireEvent.touchStart(el, { touches: [touch(100, 100)] });
    fireEvent.touchMove(el, { touches: [touch(120, 130)] });

    expect(latestPan).toHaveBeenCalledTimes(1);
    expect(firstPan).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith({ scale: 1, x: 25, y: 35 });
  });
});
