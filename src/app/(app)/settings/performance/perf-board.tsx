"use client";

import { useTransition } from "react";
import type { PerfStatus, PerfSuggestionView } from "@/lib/perf-suggestions";
import { setPerfStatusAction } from "./actions";

const SAFETY_LABEL: Record<PerfSuggestionView["safety"], string> = {
  safe: "Safe — can't change any result",
  moderate: "Moderate — refactor, output-identical",
  larger: "Larger — new precompute, staleness contract",
};

const STATUS_LABEL: Record<PerfStatus, string> = {
  pending: "Pending",
  approved: "Approved — Claude to implement",
  applied: "Applied ✓",
  dismissed: "Dismissed",
};

const STATUS_ORDER: PerfStatus[] = ["approved", "pending", "applied", "dismissed"];

export function PerfBoard({
  suggestions,
  isAdmin,
}: {
  suggestions: PerfSuggestionView[];
  isAdmin: boolean;
}) {
  const groups = STATUS_ORDER.map((st) => ({
    status: st,
    items: suggestions.filter((s) => s.status === st),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.status} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            {STATUS_LABEL[g.status]}{" "}
            <span className="text-subtle tnum">({g.items.length})</span>
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
            {g.items.map((s) => (
              <Card key={s.key} s={s} isAdmin={isAdmin} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Card({ s, isAdmin }: { s: PerfSuggestionView; isAdmin: boolean }) {
  const [pending, start] = useTransition();

  function set(status: PerfStatus) {
    const fd = new FormData();
    fd.set("key", s.key);
    fd.set("status", status);
    start(() => setPerfStatusAction(fd));
  }

  return (
    <div className={`rounded-xl border border-border-soft p-4 ${pending ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{s.title}</h3>
            <SafetyChip safety={s.safety} />
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {s.pages.map((p) => (
              <span key={p} className="text-[11px] px-1.5 py-0.5 rounded bg-bg-elev-2 text-muted">
                {p}
              </span>
            ))}
          </div>
        </div>
        {/* Complexity before → after */}
        <div className="text-xs text-right shrink-0">
          <div className="text-subtle">Complexity</div>
          <div className="font-mono">
            <span className="text-warn-soft-fg">{s.bigOBefore}</span>
            <span className="text-subtle mx-1">→</span>
            <span className="text-good-soft-fg">{s.bigOAfter}</span>
          </div>
        </div>
      </div>

      <p className="text-sm text-muted mt-3 leading-relaxed">{s.whatsSlow}</p>
      <p className="text-sm mt-2 leading-relaxed">
        <span className="font-medium">Fix:</span>{" "}
        <span className="text-muted">{s.fix}</span>
      </p>
      <p className="text-[11px] text-subtle mt-2 font-mono">{s.location}</p>

      {isAdmin && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-subtle mr-1">
            {s.how === "db-config"
              ? "DB-level change"
              : "Code change — approving signals Claude to implement it"}
          </span>
          {s.status !== "approved" && s.status !== "applied" && (
            <StatusButton onClick={() => set("approved")} disabled={pending} primary>
              Approve
            </StatusButton>
          )}
          {s.status !== "applied" && (
            <StatusButton onClick={() => set("applied")} disabled={pending}>
              Mark applied
            </StatusButton>
          )}
          {s.status !== "dismissed" && (
            <StatusButton onClick={() => set("dismissed")} disabled={pending}>
              Dismiss
            </StatusButton>
          )}
          {s.status !== "pending" && (
            <StatusButton onClick={() => set("pending")} disabled={pending}>
              Reset
            </StatusButton>
          )}
        </div>
      )}
    </div>
  );
}

function StatusButton({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-xs px-2.5 py-1 rounded-lg border cursor-pointer disabled:opacity-50 transition-colors ${
        primary
          ? "border-accent text-accent hover:bg-accent hover:text-bg"
          : "border-border-soft text-muted hover:text-fg hover:border-accent"
      }`}
    >
      {children}
    </button>
  );
}

function SafetyChip({ safety }: { safety: PerfSuggestionView["safety"] }) {
  // Colorblind-safe: the word carries the meaning; the chip tint is a
  // secondary cue only.
  const cls =
    safety === "safe"
      ? "bg-good-soft-bg text-good-soft-fg"
      : safety === "moderate"
        ? "bg-bg-elev-2 text-muted"
        : "bg-warn-soft-bg text-warn-soft-fg";
  return (
    <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${cls}`}>
      {SAFETY_LABEL[safety]}
    </span>
  );
}
