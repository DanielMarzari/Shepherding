import { ReferenceListPage } from "@/components/ReferenceListPage";

export default async function StaffPage() {
  return (
    <ReferenceListPage
      listName="REFERENCE - Church Staff"
      navActive="Staff"
      breadcrumb="Staff"
      heading="Church staff"
      subhead="Synced from PCO list REFERENCE - Church Staff. Updates whenever the list is refreshed in PCO and we re-sync."
    />
  );
}
