import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/AuthLayout";
import { getSession } from "@/lib/auth";
import { CHURCH_EMAIL_DOMAIN } from "@/lib/church-auth";
import { SignupForm } from "./form";

export default async function SignupPage() {
  const s = await getSession();
  if (s) redirect(s.orgId ? "/" : "/orgs");
  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Create your account</h1>
      <p className="text-sm text-muted mb-6">
        Use your Faith Church email. We&rsquo;ll send you a link to confirm it&rsquo;s you.
      </p>
      <SignupForm domain={CHURCH_EMAIL_DOMAIN} />
      <p className="mt-6 text-sm text-muted text-center">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
