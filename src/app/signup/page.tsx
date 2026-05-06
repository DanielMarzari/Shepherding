import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/AuthLayout";
import { getSession } from "@/lib/auth";
import { SignupForm } from "./form";

export default async function SignupPage() {
  const s = await getSession();
  if (s) redirect(s.orgId ? "/" : "/orgs");
  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Create your account</h1>
      <p className="text-sm text-muted mb-6">
        Then pick or create an organization for your church.
      </p>
      <SignupForm />
      <p className="mt-6 text-sm text-muted text-center">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
