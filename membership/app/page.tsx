import Link from "next/link";
export default function Home() {
  return (
    <main className="landing">
      <nav className="topbar">
        <Link className="brand" href="https://ktebli.vercel.app">
          ktebli
        </Link>
        <Link className="button subtle" href="/auth">
          Sign in ↗
        </Link>
      </nav>
      <section className="hero">
        <p className="eyebrow">MADE FOR AMBITION IN LEBANON</p>
        <h1>
          The right opportunity.
          <br />
          <em>A clearer next step.</em>
        </h1>
        <p className="intro">
          Create your free profile now. When membership opens, you will be able
          to review current notices, save promising ones, and assess how they
          fit your work.
        </p>
        <Link className="button" href="/auth">
          Create your account <span>↗</span>
        </Link>
        <p className="muted">
          Your profile is free to create. Membership is $20/month when checkout
          opens.
        </p>
      </section>
      <section className="feature-grid">
        <article>
          <span className="number">01</span>
          <h2>Built around you</h2>
          <p>
            Record your work, strengths, and location. These details will help
            shape a shortlist when matching opens.
          </p>
        </article>
        <article>
          <span className="number">02</span>
          <h2>Keep the source in sight</h2>
          <p>
            When the board opens, review original notices and supporting
            evidence before deciding to apply.
          </p>
        </article>
        <article>
          <span className="number">03</span>
          <h2>A head start on your proposal</h2>
          <p>
            When membership checkout opens, each paid cycle will include one $20
            credit toward a $149, $299, or $449 proposal package.
          </p>
        </article>
      </section>
      <footer>
        © Ktebli{" "}
        <span>
          One credit per paid cycle. No stacking or rollover. Matching measures
          fit, never your chance of winning.
        </span>
        <span>
          <Link href="/membership-details">Membership details</Link> ·{" "}
          <Link href="/data-use">How account data is used</Link>
        </span>
      </footer>
    </main>
  );
}
