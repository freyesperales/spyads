const FAQS: Array<{ q: string; a: string }> = [
  {
    q: "Is this legal?",
    a: "Yes. We only query public ad libraries — Meta's Ad Library, Google's Ads Transparency Center, etc. Those are official, free, public databases that anyone can browse manually. We just save you the clicking.",
  },
  {
    q: "Is it really free?",
    a: "The free scan is real and unlimited per brand. We make money on the paid tier (weekly tracking, alerts, multi-brand dashboards) — but you never have to pay to run a one-off scan.",
  },
  {
    q: "What's the catch with the email?",
    a: "We email you a copy of the report so you don't lose it. We may also email you once or twice about the paid product. You can unsubscribe in one click. We don't sell your email — see the privacy line in the footer.",
  },
  {
    q: "How many ads can I see per brand?",
    a: "Currently capped at 60 ads per scan across all platforms. That's plenty for spotting messaging patterns. The paid plan lifts the cap and adds historical tracking.",
  },
  {
    q: "Why doesn't it find anything sometimes?",
    a: "Not every brand runs ads, and not every country exposes the full library. Smaller brands and certain regions just don't appear. We tell you which sources we hit and which came up empty.",
  },
  {
    q: "Can you build a custom dashboard for my agency?",
    a: "Yes. Run a scan first, then there's a CTA at the bottom of the report to get in touch.",
  },
];

export function FAQ() {
  return (
    <section className="mx-auto max-w-3xl px-5 mt-24">
      <h2 className="text-2xl md:text-3xl font-bold mb-8">FAQ</h2>
      <div className="grid gap-3">
        {FAQS.map((item) => (
          <details key={item.q} className="card p-5">
            <summary className="font-medium flex justify-between items-center">
              <span>{item.q}</span>
              <span className="text-[var(--color-text-muted)] text-xl">+</span>
            </summary>
            <p className="mt-3 text-[var(--color-text-muted)] leading-relaxed">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
