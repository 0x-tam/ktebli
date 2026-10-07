import ProposalCheckout from "./checkout";

export default function ProposalCheckoutPage() {
  return (
    <ProposalCheckout
      creditCheckoutEnabled={
        process.env.MEMBERSHIP_CREDIT_BRIDGE_ENABLED === "true"
      }
    />
  );
}
