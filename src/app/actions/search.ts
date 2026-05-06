"use server";

import { requireOrg } from "@/lib/auth";
import { getSyncSettings } from "@/lib/pco";
import { searchPeople, type SearchHit } from "@/lib/people-read";

export interface SearchResults {
  query: string;
  hits: SearchHit[];
}

export async function searchPeopleAction(query: string): Promise<SearchResults> {
  const session = await requireOrg();
  const settings = getSyncSettings(session.orgId);
  const hits = searchPeople(session.orgId, query, settings.activityMonths, 8);
  return { query, hits };
}
