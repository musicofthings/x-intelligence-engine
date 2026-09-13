import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { listCampaigns } from "@/lib/db/store";
import { snapshotFor } from "@/lib/session/engine";
import { SessionCockpit } from "@/components/session/cockpit";

export default async function SessionPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const [snap, campaigns] = await Promise.all([
    snapshotFor(session.user.id),
    listCampaigns(session.user.id),
  ]);
  if (campaigns.length === 0) redirect("/app/onboarding");
  return <SessionCockpit initial={snap} campaigns={campaigns} />;
}
