import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./form";

export default async function LoginPage() {
  const s = await getSession();
  if (s) redirect(s.orgId ? "/" : "/orgs");
  return (
    <div className="min-h-screen grid place-items-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <span className="w-7 h-7 rounded grid place-items-center bg-accent text-[var(--accent-fg)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12c0-3 3-6 9-6s9 3 9 6-3 6-9 6-9-3-9-6Z" />
            </svg>
          </span>
          <span className="font-semibold tracking-tight">Shepherding</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Sign in</h1>
        <p className="text-sm text-muted mb-6">Use your email and password.</p>
        <LoginForm />
        <p className="mt-6 text-sm text-muted text-center">
          New here?{" "}
          <Link href="/signup" className="text-accent hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
