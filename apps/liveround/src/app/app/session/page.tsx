import { requirePageUser } from "@/auth";
import { redirect } from "next/navigation";
import { listCampaigns } from "@/lib/db/store";
import { snapshotFor } from "@/lib/session/engine";
import { SessionCockpit } from "@/components/session/cockpit";

export default async function SessionPage() {
  const user = await requirePageUser();
  const [snap, campaigns] = await Promise.all([snapshotFor(user.id), listCampaigns(user.id)]);
  if (campaigns.length === 0) redirect("/app/onboarding");
  return <SessionCockpit initial={snap} campaigns={campaigns} />;
}
