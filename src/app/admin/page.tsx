import { cookies } from "next/headers";
import { adminCookieName, verifyAdminCookie } from "@/lib/auth";
import { listScans, type ScanRow } from "@/lib/db";
import { Footer } from "@/components/Footer";
import { Logo } from "@/components/Logo";
import { AdminLoginForm } from "@/components/AdminLoginForm";
import { LeadsTable } from "@/components/LeadsTable";

export const dynamic = "force-dynamic";

interface Lead {
  id: string;
  brand: string;
  email: string;
  company: string;
  countries: string[];
  status: string;
  resultCount: number;
  createdAt: string;
}

function rowToLead(r: ScanRow): Lead {
  let countries: string[] = [];
  try {
    const parsed: unknown = JSON.parse(r.countries);
    if (Array.isArray(parsed)) countries = parsed as string[];
  } catch {
    /* ignore */
  }
  return {
    id: r.id,
    brand: r.brand,
    email: r.email,
    company: r.company ?? "",
    countries,
    status: r.status,
    resultCount: r.result_count,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export default async function AdminPage() {
  const c = await cookies();
  const authed = verifyAdminCookie(c.get(adminCookieName())?.value);

  return (
    <main>
      <header className="mx-auto max-w-6xl px-5 pt-6 flex items-center justify-between">
        <a href="/"><Logo /></a>
        <span className="badge">admin</span>
      </header>
      <div className="mx-auto max-w-6xl px-5 mt-10">
        {authed ? (
          <LeadsTable leads={listScans().map(rowToLead)} />
        ) : (
          <AdminLoginForm />
        )}
      </div>
      <Footer />
    </main>
  );
}
