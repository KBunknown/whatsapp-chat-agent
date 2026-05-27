import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function isAuthConfigured(env = process.env): boolean {
  return Boolean(env.ADMIN_USERNAME?.trim() && env.ADMIN_PASSWORD?.trim());
}

export function isProduction(env = process.env): boolean {
  return env.NODE_ENV === "production";
}

export function createBasicAuthMiddleware(env = process.env) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isPublicRoute(req.path)) {
      next();
      return;
    }

    if (!isAuthConfigured(env)) {
      if (!isProduction(env)) {
        next();
        return;
      }
      res.status(503).json({ error: "ADMIN_USERNAME and ADMIN_PASSWORD must be configured before exposing the dashboard." });
      return;
    }

    const credentials = parseBasicAuth(req.header("authorization") || "");
    if (
      credentials &&
      timingSafeEqual(credentials.username, env.ADMIN_USERNAME || "") &&
      timingSafeEqual(credentials.password, env.ADMIN_PASSWORD || "")
    ) {
      next();
      return;
    }

    res.setHeader("WWW-Authenticate", 'Basic realm="WhatsApp Campaign Dashboard"');
    res.status(401).json({ error: "Authentication required." });
  };
}

export function parseBasicAuth(header: string): { username: string; password: string } | null {
  const [scheme, encoded] = header.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "basic" || !encoded) return null;
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    };
  } catch {
    return null;
  }
}

function isPublicRoute(path: string): boolean {
  return path === "/api/health" || path.startsWith("/webhooks/whatsapp");
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
