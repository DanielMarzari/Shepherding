import crypto from "node:crypto";
import Link from "next/link";
import { AuthLayout } from "@/components/AuthLayout";
import { getDb } from "@/lib/db";
import { ConfirmForm } from "./form";

/** Where a sign-up link lands. Looking the link up is read-only; only the
 *  button uses it (see confirmAction for why). */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  const pending = token
    ? (getDb()
        .prepare(
          `SELECT email FROM pending_signups
            WHERE token_hash = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
        )
        .get(crypto.createHash("sha256").update(token).digest("hex")) as
        | { email: string }
        | undefined)
    : undefined;

  return (
    <AuthLayout>
      {pending ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight mb-1">Confirm your email</h1>
          <p className="text-sm text-muted mb-6">
            Finish creating the account for{" "}
            <strong className="text-fg">{pending.email}</strong>.
          </p>
          <ConfirmForm token={token} />
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight mb-1">This link doesn&rsquo;t work</h1>
          <p className="text-sm text-muted mb-6">
            It has expired, been used already, or was copied incompletely. Links last 24
            hours and work once.
          </p>
          <p className="text-sm text-muted">
            <Link href="/signup" className="text-accent hover:underline">
              Sign up again
            </Link>{" "}
            for a new link, or{" "}
            <Link href="/login" className="text-accent hover:underline">
              sign in
            </Link>{" "}
            if you&rsquo;ve already confirmed.
          </p>
        </>
      )}
    </AuthLayout>
  );
}
