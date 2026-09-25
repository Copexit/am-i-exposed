import { describe, it, expect } from "vitest";
import { mapApiErrorMessage } from "../error-message";
import { ApiError } from "../fetch-with-retry";

// Echo translator: returns the key so assertions can check which message was picked
const t = (key: string) => key;
const hosted = { isUmbrel: false, isCustomApi: false };

describe("mapApiErrorMessage", () => {
  it("maps NOT_FOUND to a non-retryable message", () => {
    expect(mapApiErrorMessage(new ApiError("NOT_FOUND"), t, hosted)).toEqual({
      message: "errors.not_found",
      retryable: false,
    });
  });

  it("picks the backend-specific network message", () => {
    const err = new ApiError("NETWORK_ERROR", "Request timed out");
    expect(mapApiErrorMessage(err, t, hosted).message).toBe("errors.network");
    expect(mapApiErrorMessage(err, t, { isUmbrel: true, isCustomApi: false }).message).toBe("errors.network_umbrel");
    expect(mapApiErrorMessage(err, t, { isUmbrel: false, isCustomApi: true }).message).toBe("errors.network_custom");
  });

  it("maps RATE_LIMITED and API_UNAVAILABLE", () => {
    expect(mapApiErrorMessage(new ApiError("RATE_LIMITED"), t, hosted).message).toBe("errors.rate_limited");
    expect(mapApiErrorMessage(new ApiError("API_UNAVAILABLE"), t, hosted).message).toBe("errors.api_unavailable");
  });

  it("maps a fetch TypeError to the blocked-request message", () => {
    expect(mapApiErrorMessage(new TypeError("Failed to fetch"), t, hosted).message).toBe("errors.fetch_blocked");
  });

  it("uses the fallback for other errors, else the generic message", () => {
    expect(mapApiErrorMessage(new Error("boom"), t, { ...hosted, fallback: "Invalid xpub" }).message).toBe("Invalid xpub");
    expect(mapApiErrorMessage(new Error("boom"), t, hosted).message).toBe("errors.unexpected");
  });
});
