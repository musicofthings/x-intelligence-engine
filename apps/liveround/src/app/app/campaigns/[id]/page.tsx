import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { getCampaign } from "@/lib/db/store";
import { CampaignEditor } from "@/components/campaigns/editor";

export default async function CampaignEditPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign || campaign.userId !== session.user.id) notFound();
  return <CampaignEditor campaign={campaign} />;
}
