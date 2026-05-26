import type { TargetOption } from "@/lib/assignments-types";
import type { MirDoc } from "@/lib/mir-read";
import { createMirAction, updateMirAction } from "./actions";
import { DeleteMirButton } from "./DeleteMirButton";

/** One form used for both create and edit, with the same five
 *  logic-model sections in order. For non-admin viewers every field
 *  renders read-only so the report stays a reference, not editable.
 *  `staffOptions` populates the Lead / Sponsor pickers. */
export function MirForm({
  mode,
  mir,
  staffOptions,
  isAdmin = true,
}: {
  mode: "create" | "edit";
  mir?: MirDoc;
  staffOptions: TargetOption[];
  isAdmin?: boolean;
}) {
  const action = mode === "create" ? createMirAction : updateMirAction;
  const readOnly = !isAdmin;

  return (
    <>
      <form action={action} className="space-y-5">
        {mir && <input type="hidden" name="id" value={mir.id} />}
        <Field
          label="Title"
          name="title"
          required
          defaultValue={mir?.title ?? ""}
          readOnly={readOnly}
          placeholder="e.g. Small Groups"
        />
        <Field
          label="Target audience"
          name="targetAudience"
          defaultValue={mir?.targetAudience ?? ""}
          readOnly={readOnly}
          placeholder="Who is this ministry for?"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <StaffPicker
            label="Lead"
            name="leadPersonId"
            options={staffOptions}
            selectedId={mir?.lead?.personId ?? null}
            readOnly={readOnly}
            hint="Owns the day-to-day of this report."
          />
          <StaffPicker
            label="Sponsor"
            name="sponsorPersonId"
            options={staffOptions}
            selectedId={mir?.sponsor?.personId ?? null}
            readOnly={readOnly}
            hint="Staff member accountable for the ministry's outcomes."
          />
        </div>

        <Block
          label="Resources"
          hint="What's being invested — staff time, volunteers, dollars, space, materials."
          name="resources"
          defaultValue={mir?.resources ?? ""}
          readOnly={readOnly}
        />
        <Block
          label="Activities"
          hint="What the ministry actually does week to week — the program in motion."
          name="activities"
          defaultValue={mir?.activities ?? ""}
          readOnly={readOnly}
        />
        <Block
          label="Outputs"
          hint="Countable deliverables — meetings held, people served, materials produced."
          name="outputs"
          defaultValue={mir?.outputs ?? ""}
          readOnly={readOnly}
        />
        <Block
          label="Outcomes"
          hint="Short- to medium-term changes in the target audience as a result."
          name="outcomes"
          defaultValue={mir?.outcomes ?? ""}
          readOnly={readOnly}
        />
        <Block
          label="Impact"
          hint="The long-term transformation this ministry is aiming at."
          name="impact"
          defaultValue={mir?.impact ?? ""}
          readOnly={readOnly}
        />

        {!readOnly && (
          <div className="flex items-center justify-between pt-2">
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg text-xs font-medium cursor-pointer"
            >
              {mode === "create" ? "Create report" : "Save changes"}
            </button>
            {mir && (
              <span className="text-[11px] text-subtle tnum">
                Last updated {new Date(mir.updatedAt).toLocaleString()}
              </span>
            )}
          </div>
        )}
      </form>

      {!readOnly && mode === "edit" && mir && (
        <div className="mt-6 pt-4 border-t border-border-softer flex justify-end">
          <DeleteMirButton id={mir.id} />
        </div>
      )}
    </>
  );
}

function Field({
  label,
  name,
  defaultValue,
  readOnly,
  required,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  readOnly?: boolean;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-muted uppercase tracking-wider">
        {label}
      </span>
      <input
        name={name}
        defaultValue={defaultValue}
        required={required}
        readOnly={readOnly}
        placeholder={placeholder}
        className="w-full bg-bg-elev-2 border border-border-soft rounded px-2.5 py-1.5 text-sm text-fg placeholder:text-subtle read-only:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
    </label>
  );
}

function StaffPicker({
  label,
  name,
  options,
  selectedId,
  readOnly,
  hint,
}: {
  label: string;
  name: string;
  options: TargetOption[];
  selectedId: string | null;
  readOnly?: boolean;
  hint?: string;
}) {
  // If the saved id isn't on the current staff list (departed staff,
  // unsynced list), keep it in the menu so it can still display.
  const has = selectedId
    ? options.some((o) => o.id === selectedId)
    : true;
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-muted uppercase tracking-wider">
        {label}
      </span>
      {hint && <span className="block text-[11px] text-subtle">{hint}</span>}
      <select
        name={name}
        defaultValue={selectedId ?? ""}
        required
        disabled={readOnly}
        className="w-full bg-bg-elev-2 border border-border-soft rounded px-2.5 py-1.5 text-sm text-fg disabled:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
      >
        <option value="" disabled>
          — pick a staff member —
        </option>
        {!has && selectedId && (
          <option value={selectedId}>
            (no longer on staff list · keep)
          </option>
        )}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {options.length === 0 && (
        <span className="block text-[11px] text-warn-soft-fg">
          The REFERENCE - Church Staff list is empty or not synced.
        </span>
      )}
    </label>
  );
}

function Block({
  label,
  hint,
  name,
  defaultValue,
  readOnly,
}: {
  label: string;
  hint: string;
  name: string;
  defaultValue?: string;
  readOnly?: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-muted uppercase tracking-wider">
        {label}
      </span>
      <span className="block text-[11px] text-subtle">{hint}</span>
      <textarea
        name={name}
        defaultValue={defaultValue}
        readOnly={readOnly}
        rows={5}
        className="w-full bg-bg-elev-2 border border-border-soft rounded px-2.5 py-2 text-sm text-fg placeholder:text-subtle read-only:opacity-80 font-[inherit] resize-y focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
    </label>
  );
}
