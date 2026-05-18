import { ReferenceListPage } from "@/components/ReferenceListPage";

export default async function ShepherdTeamPage() {
  return (
    <ReferenceListPage
      listName="REFERENCE - Shepherd Team"
      navActive="Shepherd team"
      breadcrumb="Shepherd team"
      heading="Shepherd team"
      subhead="Synced from PCO list REFERENCE - Shepherd Team. Use this to see who is officially designated for shepherding work — distinct from anyone leading a group or team (see /shepherds for that)."
    />
  );
}
