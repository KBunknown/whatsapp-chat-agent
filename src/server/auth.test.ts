import { describe, expect, it, vi } from "vitest";
import { createBasicAuthMiddleware, isAuthConfigured, parseBasicAuth } from "./auth.js";

describe("basic auth helpers", () => {
  it("parses Basic auth credentials", () => {
    const header = `Basic ${Buffer.from("admin:secret").toString("base64")}`;
    expect(parseBasicAuth(header)).toEqual({ username: "admin", password: "secret" });
  });

  it("rejects invalid auth headers", () => {
    expect(parseBasicAuth("Bearer token")).toBeNull();
    expect(parseBasicAuth("Basic not-base64")).toBeNull();
  });

  it("requires both admin username and password", () => {
    expect(isAuthConfigured({ ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "secret" })).toBe(true);
    expect(isAuthConfigured({ ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "" })).toBe(false);
  });

  it("allows health checks without credentials in production", () => {
    const next = vi.fn();
    const middleware = createBasicAuthMiddleware({ NODE_ENV: "production" });
    middleware(mockRequest("/api/health"), mockResponse() as never, next);
    expect(next).toHaveBeenCalled();
  });

  it("blocks protected production routes when admin credentials are missing", () => {
    const next = vi.fn();
    const res = mockResponse();
    const middleware = createBasicAuthMiddleware({ NODE_ENV: "production" });
    middleware(mockRequest("/api/dashboard"), res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it("requires valid credentials for protected routes when configured", () => {
    const next = vi.fn();
    const middleware = createBasicAuthMiddleware({
      NODE_ENV: "production",
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: "secret"
    });
    const header = `Basic ${Buffer.from("admin:secret").toString("base64")}`;
    middleware(mockRequest("/api/dashboard", header), mockResponse() as never, next);
    expect(next).toHaveBeenCalled();
  });
});

function mockRequest(path: string, authorization = "") {
  return {
    path,
    header: vi.fn((name: string) => (name.toLowerCase() === "authorization" ? authorization : ""))
  } as never;
}

function mockResponse() {
  const res = {
    setHeader: vi.fn(),
    status: vi.fn(),
    json: vi.fn()
  };
  res.status.mockReturnValue(res);
  return res;
}
