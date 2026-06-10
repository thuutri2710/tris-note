import { describe, it, expect } from "vitest";
import { buildAuthUrl, parseAuthCode } from "../src/background/oauth";

describe("buildAuthUrl", () => {
  it("builds the Notion authorize URL with required params", () => {
    const url = new URL(
      buildAuthUrl("client-123", "https://id.chromiumapp.org/"),
    );
    expect(url.origin + url.pathname).toBe(
      "https://api.notion.com/v1/oauth/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("owner")).toBe("user");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://id.chromiumapp.org/",
    );
  });
});

describe("parseAuthCode", () => {
  it("extracts the code from the redirect URL", () => {
    expect(
      parseAuthCode("https://id.chromiumapp.org/?code=abc123&state=x"),
    ).toBe("abc123");
  });

  it("throws when the user denied access (error param)", () => {
    expect(() =>
      parseAuthCode("https://id.chromiumapp.org/?error=access_denied"),
    ).toThrow(/access_denied/);
  });

  it("throws when no code is present", () => {
    expect(() => parseAuthCode("https://id.chromiumapp.org/")).toThrow(
      /no authorization code/i,
    );
  });
});
