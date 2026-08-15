import type { Metadata } from "next";
import "./globals.css";
import { BackgroundLayer } from "@/app/components/BackgroundLayer";
import { HeaderContent } from "@/app/components/HeaderContent";
import { Footer } from "@/app/components/Footer";
import { Providers } from "@/app/providers";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Bullet Protocol — Ansem Backed",
  description:
    "Ansem-backed up-only floor token on Solana. Mint, burn, borrow, and leverage BULLET.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased bg-[#000000] selection:bg-[var(--accent)] selection:text-[var(--accent-foreground)] relative">
        <BackgroundLayer />
        <Toaster position="bottom-right" />

        <Providers>
          <div className="flex flex-col min-h-screen">
            <HeaderContent />

            <main className="flex-1 w-full max-w-6xl mx-auto px-3 sm:px-4 py-5 sm:py-8 relative z-10 lg:px-4 lg:py-8 docs-main-shell">
              {children}
            </main>

            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
