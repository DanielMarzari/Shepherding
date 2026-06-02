"use client";

import { useState, useTransition } from "react";
import { setOrgWideAccessAction } from "./actions";

/** Per-shepherd "sees the whole org" switch. The exception to
 *  shepherd-map scoping: by default a shepherd's access is limited to
 *  what they oversee; flipping this on lets them see everything.
 *  Optimistic, reverts on server failure. */
export function OrgAccessToggle({
  personId,
  initial,
  disabled,
}: {
  personId: string;
  initial: boolean;
  disabled?: boolean;
}) {
  const [on, setOn] = useState(initial);
  const [, startTransition] = useTransition();

  function toggle() {
    if (disabled) return;
    const next = !on;
    setOn(next);
    startTransition(async () => {
      const res = await setOrgWideAccessAction(personId, next);
      if (!res.ok) setOn(!next);
    });
  }

  return (
    <label
      className={`flex items-center gap-1.5 text-xs ${
        disabled ? "opacity-60" : "cursor-pointer"
      }`}
      title="When on, this shepherd can see the whole organization — not just the ministry areas they oversee."
    >
      <input
        type="checkbox"
        checked={on}
        onChange={toggle}
        disabled={disabled}
        className="accent-[var(--accent)] w-3.5 h-3.5 cursor-pointer"
      />
      <span className={on ? "text-accent font-medium" : "text-muted"}>
        Whole-org access
      </span>
    </label>
  );
}
