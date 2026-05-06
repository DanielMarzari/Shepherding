import Image from "next/image";
import type { ReactNode } from "react";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col px-6 py-12">
      <div className="flex-1 grid place-items-center">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 mb-8 justify-center">
            <Image src="/icon.svg" alt="Shepherding" width={36} height={36} unoptimized />
            <span className="font-semibold tracking-tight text-lg">Shepherding</span>
          </div>
          {children}
        </div>
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
