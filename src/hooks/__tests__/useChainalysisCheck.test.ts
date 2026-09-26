// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/analysis/cex-risk/chainalysis-check", async (orig) => {
  const real = await orig<typeof import("@/lib/analysis/cex-risk/chainalysis-check")>();
  const fail = async () => { throw new real.ChainalysisRateLimitError(); };
  return { ...real, checkChainalysis: fail, checkChainalysisViaTor: fail, checkChainalysisDirect: fail };
});

import { useChainalysisCheck } from "../useChainalysisCheck";

const ADDRESSES = ["addr"];

describe("useChainalysisCheck", () => {
  it.each([true, false])("shows a rate-limit message on 429 (umbrel=%s)", async (isUmbrel) => {
    const { result } = renderHook(() => useChainalysisCheck(ADDRESSES, isUmbrel));
    await act(() => result.current.runChainalysis());
    expect(result.current.chainalysis.status).toBe("error");
    expect(result.current.chainalysis.error).toBe("cex.errorRateLimited");
  });
});
