// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const failure = vi.hoisted(() => ({ kind: "rate" as "rate" | "service" }));

vi.mock("@/lib/analysis/cex-risk/chainalysis-check", async (orig) => {
  const real = await orig<typeof import("@/lib/analysis/cex-risk/chainalysis-check")>();
  const fail = async () => {
    throw failure.kind === "rate" ? new real.ChainalysisRateLimitError() : new real.ChainalysisServiceError();
  };
  return { ...real, checkChainalysis: fail, checkChainalysisViaTor: fail, checkChainalysisDirect: fail };
});

import { useChainalysisCheck } from "../useChainalysisCheck";

const ADDRESSES = ["addr"];

describe("useChainalysisCheck", () => {
  it.each([true, false])("shows a rate-limit message on 429 (umbrel=%s)", async (isUmbrel) => {
    failure.kind = "rate";
    const { result } = renderHook(() => useChainalysisCheck(ADDRESSES, isUmbrel));
    await act(() => result.current.runChainalysis());
    expect(result.current.chainalysis.status).toBe("error");
    expect(result.current.chainalysis.error).toBe("cex.errorRateLimited");
  });

  it.each([true, false])("blames the Chainalysis service, not the Tor sidecar, when Chainalysis errors (umbrel=%s)", async (isUmbrel) => {
    failure.kind = "service";
    const { result } = renderHook(() => useChainalysisCheck(ADDRESSES, isUmbrel));
    await act(() => result.current.runChainalysis());
    expect(result.current.chainalysis.status).toBe("error");
    expect(result.current.chainalysis.error).toBe("cex.errorService");
  });
});
