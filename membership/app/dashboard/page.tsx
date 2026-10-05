import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { dashboardData } from "@/lib/dashboard";
import Dashboard from "./workspace";
import { billingEnabled } from "@/lib/stripe";
import { accountPath } from "@/lib/paths";
export const dynamic = "force-dynamic";
export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect(accountPath("/auth"));
  const data = await dashboardData(user.id);
  return (
    <Dashboard
      initial={JSON.parse(JSON.stringify(data))}
      name={user.name}
      email={user.email}
      verified={user.emailVerified}
      billingEnabled={billingEnabled()}
      proposalOrigin={
        new URL(process.env.PROPOSAL_SITE_ORIGIN ?? "https://ktebli.vercel.app")
          .origin
      }
    />
  );
}
