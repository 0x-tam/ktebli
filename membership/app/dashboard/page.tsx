import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { dashboardData } from "@/lib/dashboard";
import Dashboard from "./workspace";
import { billingEnabled } from "@/lib/stripe";
import { authPath, boardPath, parseBoardView } from "@/lib/navigation";
export const dynamic = "force-dynamic";
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(key, value);
  }
  const initialView = parseBoardView(params);
  const user = await currentUser();
  if (!user)
    redirect(authPath(boardPath(initialView.tab, initialView.filters)));
  const data = await dashboardData(user.id);
  return (
    <Dashboard
      initial={JSON.parse(JSON.stringify(data))}
      name={user.name}
      email={user.email}
      verified={user.emailVerified}
      billingEnabled={billingEnabled()}
      initialView={initialView}
      proposalOrigin={
        new URL(process.env.PROPOSAL_SITE_ORIGIN ?? "https://ktebli.vercel.app")
          .origin
      }
    />
  );
}
