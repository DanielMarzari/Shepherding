import { requireOrg } from "@/lib/auth";
import { getSqlThemeRow } from "@/lib/builder-theme-store";
import { sqlThemeStyle } from "@/lib/builder-theme";

export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireOrg();
  // Apply this org's custom SQL-editor colors (Settings › Appearance), if any,
  // by overriding the --sql-* CSS variables. Absent row = the globals.css default.
  const theme = getSqlThemeRow(session.orgId);
  return (
    <>
      {theme && <style dangerouslySetInnerHTML={{ __html: sqlThemeStyle(theme) }} />}
      {children}
    </>
  );
}
