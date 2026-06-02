import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/AuthLayout";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./form";

export default async function LoginPage() {
  const s = await getSession();
  if (s) redirect(s.orgId ? "/" : "/orgs");
  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Sign in</h1>
      <p className="text-sm text-muted mb-6">Use your email and password.</p>
      <LoginForm />
      <p className="mt-6 text-sm text-muted text-center">
        New here?{" "}
        <Link href="/signup" className="text-accent hover:underline">
          Create an account
        </Link>
      </p>
      <div className="mt-6 pt-5 border-t border-border-soft text-center">
        <p className="text-sm text-muted">
          On your church&apos;s shepherd team? No account needed —
        </p>
        <Link
          href="/know"
          className="text-accent hover:underline text-sm font-medium"
        >
          Flag the people you know →
        </Link>
      </div>
    </AuthLayout>
  );
}
