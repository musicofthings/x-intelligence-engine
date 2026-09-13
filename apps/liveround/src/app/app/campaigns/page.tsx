import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { listCampaigns } from "@/lib/db/store";
import { Button } from "@/components/ui/button";

export default async function CampaignsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const campaigns = await listCampaigns(session.user.id);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-end justify-between gap-4">
        <h1 className="font-display text-4xl italic">Campaigns</h1>
        <Button asChild variant="paper" size="sm">
          <Link href="/app/onboarding">New</Link>
        </Button>
      </div>
      {campaigns.length === 0 ? (
        <p className="mt-10 text-muted">None yet. Setup takes a few minutes and previews a real post.</p>
      ) : (
        <ul className="mt-8 space-y-3">
          {campaigns.map((c) => (
            <li key={c.id} className="rounded-lg border border-line p-4">
              <p className="font-medium">{c.name}</p>
              <p className="mt-1 text-sm text-muted">{c.reaching}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
