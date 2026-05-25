import { loadConfig } from "../config/index.js";
import { getSession } from "../api/session.js";
import { BCPARKS_BASE_URL } from "../config/constants.js";
import { logger } from "../utils/logger.js";

export interface LoginResult {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
  }>;
}

function parseSetCookie(
  setCookie: string,
): { name: string; value: string; domain: string; path: string; httpOnly: boolean; secure: boolean; sameSite: "Strict" | "Lax" | "None" } | null {
  const parts = setCookie.split(";").map((s) => s.trim());
  const firstEq = parts[0].indexOf("=");
  if (firstEq < 0) return null;
  const name = parts[0].slice(0, firstEq);
  const value = parts[0].slice(firstEq + 1);

  let domain = "";
  let path = "";
  let httpOnly = false;
  let secure = false;
  let sameSite: "Strict" | "Lax" | "None" = "Lax";

  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    const attrName = eq < 0 ? parts[i].toLowerCase() : parts[i].slice(0, eq).toLowerCase();
    const attrValue = eq < 0 ? "" : parts[i].slice(eq + 1);

    switch (attrName) {
      case "domain":
        domain = attrValue;
        break;
      case "path":
        path = attrValue;
        break;
      case "httponly":
        httpOnly = true;
        break;
      case "secure":
        secure = true;
        break;
      case "samesite":
        sameSite = attrValue.charAt(0).toUpperCase() + attrValue.slice(1).toLowerCase() as "Strict" | "Lax" | "None";
        break;
    }
  }

  return { name, value, domain, path, httpOnly, secure, sameSite };
}

/**
 * Log in to BC Parks using email/password credentials via the API.
 * Extracts auth cookies from the login response and returns them
 * in Playwright-compatible format.
 */
export async function loginToBCParks(): Promise<LoginResult | null> {
  const config = loadConfig();
  if (!config.bcParksEmail || !config.bcParksPassword) {
    return null;
  }

  logger.info("Logging in to BC Parks as %s...", config.bcParksEmail);

  const session = await getSession();

  const cookieParts = session.cookies.split("; ");
  const xsrfCookie = cookieParts.find((c) => c.startsWith("XSRF-TOKEN="));
  if (!xsrfCookie) {
    logger.warn("No XSRF token found in session, cannot log in");
    return null;
  }

  const xsrfToken = xsrfCookie.split("=").slice(1).join("=");

  const response = await fetch(`${BCPARKS_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      Cookie: session.cookies,
      "User-Agent": session.userAgent,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-XSRF-TOKEN": xsrfToken,
      "app-language": "en-CA",
      "app-version": "5.109.174",
    },
    body: JSON.stringify({
      email: config.bcParksEmail,
      password: config.bcParksPassword,
    }),
  });

  const body = await response.text().catch(() => "");

  if (!response.ok) {
    const msg = body ? body.slice(0, 200) : `${response.status} ${response.statusText}`;
    throw new Error(`Login failed: ${msg}`);
  }

  const setCookieHeaders = response.headers.getSetCookie();
  if (setCookieHeaders.length === 0) {
    throw new Error("Login succeeded but no auth cookies returned");
  }

  const cookies: LoginResult["cookies"] = [];
  for (const sc of setCookieHeaders) {
    const parsed = parseSetCookie(sc);
    if (parsed) {
      if (!parsed.domain) {
        parsed.domain = new URL(BCPARKS_BASE_URL).hostname;
      }
      if (!parsed.path) {
        parsed.path = "/";
      }
      cookies.push(parsed);
    }
  }

  logger.info("Logged in successfully, got %d auth cookies", cookies.length);
  return { cookies };
}
