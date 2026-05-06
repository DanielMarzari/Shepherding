import Image from "next/image";
import { listAllOrgs, listOrgs, requireSession } from "@/lib/auth";
import { OrgPicker } from "./form";

export default async function OrgsPage() {
  const s = await requireSession();
  const myOrgs = listOrgs(s.user.id);
  const allOrgs = listAllOrgs();
  const myIds = new Set(myOrgs.map((o) => o.id));
  const otherOrgs = allOrgs.filter((o) => !myIds.has(o.id));

  return (
    <div className="min-h-screen flex flex-col px-6 py-12">
      <div className="max-w-2xl mx-auto w-full flex-1">
        <div className="flex items-center gap-2 mb-8">
          <Image src="/icon.svg" alt="Shepherding" width={36} height={36} unoptimized />
          <span className="font-semibold tracking-tight text-lg">Shepherding</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mb-1">
          Welcome, {s.user.name.split(" ")[0]}.
        </h1>
        <p className="text-sm text-muted mb-8">
          Pick an organization to enter — or create a new one and you&apos;ll be its admin.
        </p>
        <OrgPicker myOrgs={myOrgs} otherOrgs={otherOrgs} />
      </div>
      <p className="text-center text-[10px] text-subtle mt-8">
        Sheep icon by{" "}
        <a
          href="https://www.flaticon.com/free-icons/sheep"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted hover:text-fg underline"
          title="sheep icons"
        >
          Freepik · Flaticon
        </a>
      </p>
    </div>
  );
}
