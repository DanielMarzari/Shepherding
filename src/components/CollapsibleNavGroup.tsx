"use client";

import Link from "next/link";
import { useState } from "react";

interface NavItem {
  href: string;
  label: string;
}

/** Sidebar group whose header is a clickable toggle. Defaults to
 *  collapsed unless one of the items is currently active — in that
 *  case we expand on mount so the user can see where they are. */
export function CollapsibleNavGroup({
  label,
  items,
  active,
}: {
  label: string;
  items: NavItem[];
  active: string;
}) {
  const hasActive = items.some((i) => i.label === active);
  const [open, setOpen] = useState(hasActive);

  return (
    <div className="mt-7">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-2 mb-2 text-xs text-muted uppercase tracking-wider hover:text-fg transition-colors cursor-pointer"
      >
        <span>{label}</span>
        <span
          className={`text-[10px] transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        >
          ›
        </span>
      </button>
      {open && (
        <ul className="space-y-0.5">
          {items.map((item) => {
            const isActive = item.label === active;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`px-2 py-1.5 rounded flex items-center justify-between transition-colors ${
                    isActive
                      ? "bg-bg-elev-2 text-fg font-medium"
                      : "text-fg hover:bg-bg-elev-2"
                  }`}
                >
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
