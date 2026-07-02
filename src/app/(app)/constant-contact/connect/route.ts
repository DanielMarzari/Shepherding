import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireOrg } from "@/lib/auth";
import { sign } from "@/lib/encryption";
import { buildCcAuthorizeUrl, getDecryptedConstantContactCreds, makePkce } from "@/lib/constant-contact";

function baseUrl(req: NextRequest): string {
  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

/** Kicks off the Constant Contact OAuth2 handshake: stashes a signed PKCE
 *  verifier + state in a short-lived cookie and redirects the admin's browser
 *  to Constant Contact's authorize screen. */
export async function GET(req: NextRequest) {
  const session = await requireOrg();
  const base = baseUrl(req);
  if (session.role !== "admin") {
    return NextResponse.redirect(`${base}/constant-contact?cc_error=admin_only`);
  }
  const creds = getDecryptedConstantContactCreds(session.orgId);
  if (!creds) {
    return NextResponse.redirect(`${base}/constant-contact?cc_error=no_api_key`);
  }

  const state = crypto.randomBytes(16).toString("base64url");
  const { verifier, challenge } = makePkce();
  const exp = Date.now() + 10 * 60 * 1000;
  const redirectUri = `${base}/constant-contact/callback`;

  const res = NextResponse.redirect(buildCcAuthorizeUrl(creds.apiKey, redirectUri, state, challenge));
  res.cookies.set("cc_oauth", sign(`${state}.${verifier}.${exp}`), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
