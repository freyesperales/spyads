import { Footer } from "@/components/Footer";
import { Logo } from "@/components/Logo";

export default function NotFound() {
  return (
    <main>
      <header className="mx-auto max-w-6xl px-5 pt-6">
        <a href="/"><Logo /></a>
      </header>
      <div className="mx-auto max-w-2xl px-5 mt-32 text-center">
        <p className="mono text-sm text-[var(--color-text-muted)]">404</p>
        <h1 className="text-3xl font-bold mt-2">That scan doesn&apos;t exist</h1>
        <p className="text-[var(--color-text-muted)] mt-3">
          The scan ID either expired or never existed. Want to run a new one?
        </p>
        <a href="/" className="btn-primary inline-block mt-6">Run a scan</a>
      </div>
      <Footer />
    </main>
  );
}
