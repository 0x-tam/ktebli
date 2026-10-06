import Link from "next/link";
export default function Home() {
  const checkoutOpen = process.env.MEMBERSHIP_BILLING_ENABLED === "true";
  return (
    <main className="landing">
      <nav className="topbar">
        <Link
          className="brand"
          href="https://ktebli.vercel.app"
          aria-label="Ktebli home"
        >
          KTEBLI<span className="brand-mark">!</span>
        </Link>
        <Link className="button subtle" href="/auth">
          Sign in ↗
        </Link>
      </nav>
      <section className="hero">
        <p className="eyebrow">MADE FOR AMBITION IN LEBANON</p>
        <h1>
          Browse public opportunities.
          <br />
          <em>Take a clearer next step.</em>
        </h1>
        <p className="intro">
          Create a free account to explore notices for Lebanon and check each
          opportunity against its original source.
        </p>
        <Link className="button" href="/auth">
          Get started <span>↗</span>
        </Link>
        <p className="muted">
          Browsing is free. Membership checkout is{" "}
          {checkoutOpen ? "open at $20/month" : "not open yet"}.
        </p>
      </section>
      <footer>
        © Ktebli
        <span>
          <Link href="/membership-details">Membership details</Link> ·{" "}
          <Link href="/data-use">How account data is used</Link>
        </span>
      </footer>
    </main>
  );
}
