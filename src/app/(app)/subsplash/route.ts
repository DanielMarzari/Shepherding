import { redirect } from "next/navigation";

// Subsplash has no sync and no data here. The only thing its page ever did was
// store credentials, and those now live with the other not-yet-built
// connections on the Credentials page. The route stays so old links and
// bookmarks land on the Subsplash card instead of a 404.
//
// A route handler rather than a page: a page here would render inside the
// (app) loading boundary and redirect only after streaming a skeleton, where
// this answers with a plain 307. Temporary, not permanent, so a real Subsplash
// page can come back here once there is a sync.
export function GET() {
  redirect("/settings/integrations#subsplash");
}
