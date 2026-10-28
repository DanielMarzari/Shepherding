import { redirect } from "next/navigation";

/** The membership audit moved to /membership-audit, which says what it is —
 *  /audit also roots the duplicate, name and PushPay audits, so it never
 *  belonged to this one. Kept so existing links and bookmarks still land. */
export default function AuditRedirect() {
  redirect("/membership-audit");
}
