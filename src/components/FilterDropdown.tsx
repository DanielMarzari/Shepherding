"use client";

/** A filter as a dropdown of checkboxes, each with how many rows it holds.
 *  Ticking several means any of them. Shared by the audits so their filter
 *  rows look and behave alike.
 *
 *  Which one is open is the caller's: it passes `open` and `setOpen`, and
 *  closes it on a click anywhere else — the menu stops its own clicks from
 *  getting that far. */
export function FilterDropdown({
  id,
  label,
  value,
  open,
  setOpen,
  items,
  onToggle,
}: {
  id: string;
  label: string;
  value: string;
  open: boolean;
  setOpen: (v: string | null) => void;
  items: { id: string; label: string; count: number; checked: boolean }[];
  onToggle: (id: string) => void;
}) {
  const isSet = items.some((i) => i.checked);
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(open ? null : id)}
        aria-expanded={open}
        className={`flex items-center gap-2 rounded-md border bg-bg px-3 py-1.5 text-[13px] ${
          isSet ? "border-accent ring-1 ring-accent" : "border-border-soft hover:bg-bg-elev-2"
        }`}
      >
        <span className={isSet ? "text-accent" : "text-subtle"}>{label}</span>
        <span className="font-semibold">{value}</span>
        <span className="text-subtle text-xs">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 min-w-[230px] rounded-lg border border-border-soft bg-bg-elev p-1.5 shadow-xl">
          {items.map((i) => (
            <label
              key={i.id}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded cursor-pointer hover:bg-bg-elev-2"
            >
              <input
                type="checkbox"
                checked={i.checked}
                onChange={() => onToggle(i.id)}
                className="accent-[var(--accent)] w-3.5 h-3.5"
              />
              <span className="text-[13px] flex-1">{i.label}</span>
              <span className="text-[11px] text-subtle tnum">
                {i.count.toLocaleString()}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
