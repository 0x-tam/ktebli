import Link from "next/link";

export default function MembershipDetails() {
  const checkoutOpen = process.env.MEMBERSHIP_BILLING_ENABLED === "true";
  return (
    <main className="landing">
      <nav className="topbar">
        <Link className="brand" href="https://ktebli.vercel.app">
          ktebli
        </Link>
        <Link className="button subtle" href="/auth">
          Account ↗
        </Link>
      </nav>
      <section className="hero">
        <p className="eyebrow">MEMBERSHIP DETAILS</p>
        <h1>Know what you’re joining.</h1>
        <p className="intro">
          A paid Ktebli membership is $20 USD each month. Checkout is{" "}
          {checkoutOpen ? "open" : "not open yet"}.
        </p>
      </section>
      <section className="feature-grid">
        <article>
          <span className="number">01</span>
          <h2>What you receive</h2>
          <p>
            During an active paid period, you can use the opportunity board,
            save notices, and see available in-app alerts. A completed profile
            can be used to assess fit when matching is enabled. Always confirm
            dates and eligibility on the publisher’s original notice.
          </p>
        </article>
        <article>
          <span className="number">02</span>
          <h2>One proposal credit</h2>
          <p>
            Each paid monthly cycle provides one $20 credit toward a $149, $299,
            or $449 Ktebli proposal package. The credit expires with its paid
            cycle. Credits do not stack or roll over, and an unused credit has
            no cash value.
          </p>
        </article>
        <article>
          <span className="number">03</span>
          <h2>Cancellation</h2>
          <p>
            After subscribing, you can manage your payment method or cancel
            renewal from the account’s membership portal. A cancellation set for
            the period end leaves access through the already paid period. The
            account shows the current membership state and paid-through date.
          </p>
        </article>
      </section>
      <footer>
        <Link href="https://ktebli.vercel.app">Home</Link> ·{" "}
        <Link href="/data-use">Account data</Link>
      </footer>
    </main>
  );
}
