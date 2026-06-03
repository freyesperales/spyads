import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-[var(--color-border)] py-8 text-sm text-[var(--color-text-muted)]">
      <div className="mx-auto max-w-6xl px-5 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <Logo size={20} />
        <div className="flex gap-5">
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="hover:text-[var(--color-text)]"
          >
            GitHub
          </a>
          <a href="#privacy" className="hover:text-[var(--color-text)]">
            Privacy
          </a>
          <a href="/admin" className="hover:text-[var(--color-text)]">
            Admin
          </a>
        </div>
        <p id="privacy">
          We only store the email you give us and the brand you searched.
          Nothing else.
        </p>
      </div>
    </footer>
  );
}
