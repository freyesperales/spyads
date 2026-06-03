import { Suspense } from "react";
import { Footer } from "@/components/Footer";
import { Logo } from "@/components/Logo";
import { ScanForm } from "@/components/ScanForm";
import { FAQ } from "@/components/FAQ";

const SAMPLE_BRANDS = [
  "Notion",
  "Linear",
  "Patagonia",
  "Stripe",
  "Vercel",
  "Figma",
  "Shopify",
  "Duolingo",
  "Airbnb",
];

const STEPS = [
  {
    n: "1",
    title: "Enter the brand",
    body: "Type a brand name and pick a country. That's the whole config.",
  },
  {
    n: "2",
    title: "We scan public libraries",
    body: "Meta Ad Library + Google Ads Transparency. Live progress while it runs.",
  },
  {
    n: "3",
    title: "Get the report",
    body: "Every ad with creative, copy, CTA, landing URL. Downloadable as CSV or JSON.",
  },
];

export default function HomePage() {
  return (
    <main>
      <header className="mx-auto max-w-6xl px-5 pt-6 flex items-center justify-between">
        <Logo />
        <nav className="hidden sm:flex gap-5 text-sm text-[var(--color-text-muted)]">
          <a href="#how" className="hover:text-[var(--color-text)]">
            How it works
          </a>
          <a href="#faq" className="hover:text-[var(--color-text)]">
            FAQ
          </a>
          <a href="/admin" className="hover:text-[var(--color-text)]">
            Admin
          </a>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-5 pt-16 md:pt-24 pb-12 text-center">
        <span className="badge badge-accent mb-5 inline-block">
          Free. No login. Built for marketers.
        </span>
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight max-w-4xl mx-auto">
          Spy on any brand&apos;s ads in{" "}
          <span className="gradient-text">30 seconds</span>
        </h1>
        <p className="mt-5 text-lg text-[var(--color-text-muted)] max-w-2xl mx-auto">
          We hit Meta&apos;s Ad Library and Google&apos;s Ads Transparency Center
          live, then hand you a clean report with every creative, headline, CTA,
          and landing page they&apos;re testing.
        </p>

        <div className="mt-10 max-w-xl mx-auto">
          <Suspense
            fallback={
              <div className="card p-6 max-w-xl mx-auto text-center text-[var(--color-text-muted)]">
                Loading…
              </div>
            }
          >
            <ScanForm />
          </Suspense>
        </div>

        <div className="mt-12">
          <p className="text-xs uppercase tracking-widest text-[var(--color-text-muted)] mb-3">
            Try it with a brand like
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {SAMPLE_BRANDS.map((b) => (
              <span key={b} className="badge">
                {b}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-5 mt-16">
        <h2 className="text-2xl md:text-3xl font-bold mb-8 text-center">
          How it works
        </h2>
        <div className="grid md:grid-cols-3 gap-5">
          {STEPS.map((s) => (
            <div key={s.n} className="card p-6">
              <div className="mono text-3xl gradient-text font-bold mb-3">
                {s.n}
              </div>
              <h3 className="text-lg font-semibold mb-2">{s.title}</h3>
              <p className="text-[var(--color-text-muted)]">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="faq">
        <FAQ />
      </section>

      <Footer />
    </main>
  );
}
