import { throttle } from "@/lib/rate-limit";
import { handle, requireUser, readJson, json } from "@/lib/http";
import { userTransaction } from "@/lib/db";
import { profileSchema } from "@/lib/contracts";
export const GET = () =>
  handle(async () => {
    const user = await requireUser();
    const result = await userTransaction(user.id, (db) =>
      db.query("SELECT * FROM membership.profiles WHERE user_id=$1", [user.id]),
    );
    return json({
      profile: result.rows[0] ?? null,
      account: { id: user.id, name: user.name ?? "", email: user.email },
    });
  });
export const PUT = (request: Request) =>
  handle(async () => {
    const user = await requireUser(request);
    await throttle(user.id, "profile");
    const p = profileSchema.parse(await readJson(request));
    await userTransaction(user.id, (db) =>
      db.query(
        `INSERT INTO membership.profiles(user_id,organization_name,organization_type,sectors,capabilities,locations,alerts_enabled,qualifications,interests,excluded_work,opportunity_types,past_work,team_capacity,languages,budget_min,budget_max) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(user_id) DO UPDATE SET organization_name=$2,organization_type=$3,sectors=$4,capabilities=$5,locations=$6,alerts_enabled=$7,qualifications=$8,interests=$9,excluded_work=$10,opportunity_types=$11,past_work=$12,team_capacity=$13,languages=$14,budget_min=$15,budget_max=$16,revision=membership.profiles.revision+1,updated_at=now()`,
        [
          user.id,
          p.organizationName,
          p.organizationType,
          p.sectors,
          p.capabilities,
          p.locations,
          p.alertsEnabled,
          p.qualifications,
          p.interests,
          p.excludedWork,
          p.opportunityTypes,
          p.pastWork,
          p.teamCapacity,
          p.languages,
          p.budgetMin,
          p.budgetMax,
        ],
      ),
    );
    return json({ ok: true });
  });
