"use client";

import { useState, useTransition } from "react";
import { setOrgWideAccessAction } from "./actions";

/** Per-shepherd "sees the whole org" switch: the planned exception to
 *  scoping each shepherd's access to what they oversee. Nothing scopes
 *  access yet (org_wide_access, 0041, only records the intent), so today
 *  every user sees the whole org and the switch changes nothing anyone
 *  sees. The label says so. Optimistic, reverts on server failure. */
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
      className={`flex items-start gap-1.5 text-xs ${
        disabled ? "opacity-60" : "cursor-pointer"
      }`}
      title="Access is not scoped yet: today every user sees the whole organization. Once each shepherd's access is limited to the ministry areas they oversee, people with this on will still see everything."
    >
      <input
        type="checkbox"
        checked={on}
        onChange={toggle}
        disabled={disabled}
        className="accent-[var(--accent)] w-3.5 h-3.5 mt-px cursor-pointer"
      />
      <span className="leading-tight max-w-[8.5rem]">
        <span className={on ? "text-accent font-medium" : "text-muted"}>
          Whole-org access
        </span>
        <span className="block text-[11px] text-subtle">
          takes effect once access scoping exists
        </span>
      </span>
    </label>
  );
}
