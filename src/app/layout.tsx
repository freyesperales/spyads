import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "spyads — Spy on any brand's ads in 30 seconds",
  description:
    "Free public ad-library spy tool. Enter a brand, get every active ad we can find across Meta and Google. No login.",
  openGraph: {
    title: "spyads",
    description: "Spy on any brand's ads in 30 seconds.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
