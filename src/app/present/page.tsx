import { redirect } from "next/navigation";

/** /present was the invite-only intake page for the band the vocabulary used
 *  to call "present". That word is gone — the band is Unknown — and the page
 *  now lives at /know/unknown, beside the /know page it mirrors.
 *
 *  This route is kept because the old link was sent to the people who use it.
 */
export default function PresentIntakeRedirect() {
  redirect("/know/unknown");
}
