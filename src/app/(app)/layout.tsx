import { requireOrg } from "@/lib/auth";

export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOrg();
  return <>{children}</>;
}
