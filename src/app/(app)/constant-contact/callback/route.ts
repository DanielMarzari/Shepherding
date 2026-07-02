import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { requireOrg } from "@/lib/auth";
import { verifySigned } from "@/lib/encryption";
import { exchangeCcCode } from "@/lib/constant-contact";

function baseUrl(req: NextRequest): string {
  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

/** Constant Contact redirects here with ?code after the admin approves. We
 *  verify the signed state cookie, exchange the code for tokens, and store the
 *  refresh token — then bounce back to the credentials page. */
export async function GET(req: NextRequest) {
  const session = await requireOrg();
  const base = baseUrl(req);
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const store = await cookies();
  const cookieVal = verifySigned(store.get("cc_oauth")?.value);

  const done = (query: string) => {
    const res = NextResponse.redirect(`${base}/constant-contact?${query}`);
    res.cookies.set("cc_oauth", "", { path: "/", maxAge: 0 });
    return res;
  };

  if (session.role !== "admin") return done("cc_error=admin_only");
  if (oauthError) return done(`cc_error=${encodeURIComponent(oauthError)}`);
  if (!code || !state || !cookieVal) return done("cc_error=bad_state");

  const [cookieState, verifier, expStr] = cookieVal.split(".");
  if (cookieState !== state) return done("cc_error=state_mismatch");
  if (!verifier || !expStr || Date.now() > Number(expStr)) return done("cc_error=expired");

  const redirectUri = `${base}/constant-contact/callback`;
  const result = await exchangeCcCode(session.orgId, code, redirectUri, verifier);
  return done(result.ok ? "cc_connected=1" : `cc_error=${encodeURIComponent(result.error)}`);
}
