import { throttle } from "@/lib/rate-limit";
import { handle, requireUser, json, HttpError } from "@/lib/http";
import { userTransaction } from "@/lib/db";
import { stripe, appOrigin } from "@/lib/stripe";
import { safeMembershipPortal } from "@/lib/portal-policy";
import { accountPath } from "@/lib/paths";
export const POST = (request: Request) =>
  handle(async () => {
    const user = await requireUser(request);
    await throttle(user.id, "portal");
    const customer = await userTransaction(
      user.id,
      async (db) =>
        (
          await db.query(
            "SELECT stripe_customer_id FROM membership.customers WHERE user_id=$1",
            [user.id],
          )
        ).rows[0]?.stripe_customer_id as string | undefined,
    );
    if (!customer) throw new HttpError(404, "There is no billing account yet");
    const configurationId =
      process.env.STRIPE_MEMBERSHIP_PORTAL_CONFIGURATION_ID;
    if (!configurationId?.startsWith("bpc_"))
      throw new HttpError(503, "Membership portal is not configured");
    const api = stripe();
    const configuration =
      await api.billingPortal.configurations.retrieve(configurationId);
    if (!safeMembershipPortal(configuration))
      throw new HttpError(503, "Membership portal needs review");
    const session = await api.billingPortal.sessions.create({
      customer,
      configuration: configurationId,
      return_url: `${appOrigin()}${accountPath("/dashboard")}?billing=portal`,
    });
    return json({ url: session.url });
  });
