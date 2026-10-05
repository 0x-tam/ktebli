// These statements run inside a transaction after locking the account or credit.
export const reserveCreditSql = `UPDATE membership.credits SET state='reserved',reservation_id=gen_random_uuid(),reserved_at=now(),checkout_expires_at=floor(extract(epoch from now()))+1800,checkout_token=$2,tier=$3,buyer_email=$4 WHERE id=(SELECT id FROM membership.credits WHERE user_id=$1 AND state='available' AND valid_from<=now() AND expires_at>now()+interval '31 minutes' ORDER BY expires_at DESC LIMIT 1 FOR UPDATE) RETURNING *`;
export const redeemCreditSql = `UPDATE membership.credits SET state='redeemed',order_reference=$1,redeemed_at=now() WHERE id=$2 AND state='reserved' RETURNING id`;
export const releaseCreditSql = `UPDATE membership.credits SET state='available',reservation_id=NULL,reserved_at=NULL,checkout_token=NULL,tier=NULL,buyer_email=NULL,stripe_session_id=NULL,checkout_expires_at=NULL,checkout_request=NULL WHERE id=$1 AND state='reserved' AND stripe_session_id=$2 RETURNING id`;

// A stale reconciliation snapshot must never mutate a later reservation on the same credit.
export const bindReconciledSessionSql = `UPDATE membership.credits SET stripe_session_id=$1 WHERE id=$2 AND state='reserved' AND stripe_session_id IS NULL AND reservation_id=$3 AND checkout_expires_at=$4 RETURNING id`;
export const releaseOrphanCreditSql = `UPDATE membership.credits SET state='available',reservation_id=NULL,checkout_token=NULL,tier=NULL,buyer_email=NULL,reserved_at=NULL,checkout_expires_at=NULL,checkout_request=NULL WHERE id=$1 AND state='reserved' AND stripe_session_id IS NULL AND reservation_id=$2 AND checkout_expires_at=$3 RETURNING id`;

export const persistCheckoutRequestSql = `UPDATE membership.credits SET checkout_request=COALESCE(checkout_request,$1) WHERE id=$2 AND state='reserved' AND reservation_id=$3 AND checkout_token=$4 AND tier=$5 AND buyer_email=$6 AND checkout_expires_at=$7 RETURNING checkout_request,reservation_id`;

export const bindCreatedCheckoutSql = `UPDATE membership.credits SET stripe_session_id=$1 WHERE id=$2 AND reservation_id=$3 AND state='reserved' AND (stripe_session_id IS NULL OR stripe_session_id=$1) RETURNING id`;
