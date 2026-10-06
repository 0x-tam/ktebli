import Link from "next/link";

export default function DataUse() {
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
        <p className="eyebrow">ACCOUNT DATA</p>
        <h1>How your information is used.</h1>
        <p className="intro">
          This page describes the membership features currently built into
          Ktebli. Checkout remains closed until the complete privacy and
          purchase terms are published.
        </p>
      </section>
      <section className="feature-grid">
        <article>
          <span className="number">01</span>
          <h2>Account and profile</h2>
          <p>
            Neon Auth handles your name, email, password sign-in, verification,
            and session. Ktebli stores the organization and work details you
            enter, along with saved notices and in-app alerts, in a separate
            Neon database. Opportunity alerts are shown in your workspace; email
            alerts are not enabled.
          </p>
        </article>
        <article>
          <span className="number">02</span>
          <h2>Fit assessment</h2>
          <p>
            When matching is enabled, relevant profile details and notice
            excerpts are sent to TypeSafe to assess fit and possible
            eligibility. The result is guidance, not a decision by a funder or a
            guarantee of success. Matching is currently disabled.
          </p>
        </article>
        <article>
          <span className="number">03</span>
          <h2>Payments and proposals</h2>
          <p>
            When checkout opens, Stripe will handle card payments. Ktebli will
            store customer, subscription, invoice, and credit references to
            manage access and prevent duplicate credits. If you start a
            proposal, the existing Ktebli proposal service receives the intake
            and payment information needed to complete that order.
          </p>
        </article>
      </section>
      <footer>
        <Link href="https://ktebli.vercel.app">Home</Link> ·{" "}
        <Link href="/membership-details">Membership details</Link>
      </footer>
    </main>
  );
}
