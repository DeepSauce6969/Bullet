"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

const NAV_LINKS = [
  { name: "PRE-DEPOSIT", href: "/pre-deposit", isExternal: false, disabled: false },
  { name: "MINT & BURN", href: "/mint-and-burn", isExternal: false, disabled: false },
  { name: "BULLET LOANS", href: "/loans", isExternal: false, disabled: false },
  { name: "ANALYTICS", href: "/analytics", isExternal: false, disabled: false },
  { name: "DOCS", href: "#", isExternal: true, disabled: false },
] as const;

function ExternalIcon() {
  return (
    <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

export function HeaderContent() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const { publicKey, connected, disconnect } = useWallet();
  const { setVisible } = useWalletModal();

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  const displayName = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
    : "";

  const isNavActive = (href: string) =>
    pathname === href ||
    (href === "/mint-and-burn" && (pathname === "/swap" || pathname === "/mint-and-burn"));

  const linkClass = (isActive: boolean, mobile = false) => {
    const base = mobile
      ? "flex items-center justify-between px-4 py-3.5 rounded-xl text-sm font-mono font-bold tracking-wider transition-all btn-haptic"
      : "px-4 py-2.5 rounded-xl transition-all btn-haptic text-xs tracking-wider";

    if (isActive) {
      return `${base} bg-gradient-to-r from-[var(--accent)] to-[var(--accent-dark)] text-[var(--accent-foreground)] shadow-sm font-extrabold`;
    }
    return `${base} text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--inset)]/50`;
  };

  return (
    <>
      <header className="sticky top-0 z-50 bg-[var(--deep)]/85 border-b border-[var(--card-border)]/40 py-3 px-4 sm:px-6 lg:px-8 lg:py-3.5 safe-top backdrop-blur-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="lg:hidden flex items-center justify-center w-10 h-10 rounded-xl border border-[var(--card-border)]/50 bg-[var(--inset)]/40 text-[var(--foreground)] btn-haptic shrink-0"
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
            >
              {menuOpen ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>

            <Link href="/" className="flex items-center h-9 sm:h-10 btn-haptic shrink-0">
              <Image
                src="/BULLET-LOGO.png"
                alt="Bullet Logo"
                width={400}
                height={120}
                priority
                className="h-9 sm:h-10 w-auto object-contain rounded-sm"
              />
            </Link>
          </div>

          <nav className="hidden lg:flex items-center gap-1 bg-[var(--card)]/80 p-1.5 rounded-2xl text-xs font-bold font-mono border border-[var(--card-border)]/50">
            {NAV_LINKS.map((link) => {
              if (link.disabled) {
                return (
                  <span
                    key={link.name}
                    title="Coming soon"
                    className="px-4 py-2.5 rounded-xl text-xs tracking-wider text-[var(--muted)] cursor-not-allowed opacity-50"
                  >
                    {link.name}
                  </span>
                );
              }

              if (link.isExternal) {
                return (
                  <a
                    key={link.name}
                    href={link.href}
                    target={link.href.startsWith("http") ? "_blank" : undefined}
                    rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                    className="px-4 py-2.5 rounded-xl transition-all text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--inset)]/50 flex items-center gap-1.5 btn-haptic text-xs tracking-wider"
                  >
                    {link.name}
                    <ExternalIcon />
                  </a>
                );
              }

              const isActive = isNavActive(link.href);
              return (
                <Link key={link.name} href={link.href} className={linkClass(isActive)}>
                  {link.name}
                </Link>
              );
            })}
          </nav>

          <div className="flex justify-end items-center shrink-0">
            {!connected ? (
              <button
                onClick={() => setVisible(true)}
                type="button"
                className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2 sm:py-2.5 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-dark)] text-[var(--accent-foreground)] text-[10px] sm:text-xs font-mono font-bold btn-haptic shadow-sm transition hover:brightness-105 whitespace-nowrap"
              >
                <span className="w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full bg-[var(--foreground)]/70 shrink-0" />
                <span className="hidden sm:inline">Connect Wallet</span>
                <span className="sm:hidden">Connect</span>
              </button>
            ) : (
              <button
                onClick={() => disconnect()}
                type="button"
                className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-dark)] text-[var(--accent-foreground)] btn-haptic font-mono text-[10px] sm:text-xs font-bold transition hover:brightness-105 max-w-[140px] sm:max-w-none"
              >
                <span className="w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full bg-[var(--foreground)]/70 shrink-0" />
                <span className="truncate">{displayName}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <button
            type="button"
            className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          />
          <nav className="absolute top-[calc(3.75rem+env(safe-area-inset-top,0px))] left-0 right-0 mx-3 p-2 rounded-2xl bg-[var(--card)]/98 border border-[var(--card-border)]/60 shadow-xl font-mono max-h-[calc(100dvh-5rem)] overflow-y-auto">
            {NAV_LINKS.map((link) => {
              if (link.disabled) {
                return (
                  <span
                    key={link.name}
                    className="flex items-center justify-between px-4 py-3.5 rounded-xl text-sm font-mono font-bold tracking-wider text-[var(--muted)] opacity-50 cursor-not-allowed"
                  >
                    {link.name}
                  </span>
                );
              }

              if (link.isExternal) {
                return (
                  <a
                    key={link.name}
                    href={link.href}
                    target={link.href.startsWith("http") ? "_blank" : undefined}
                    rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                    className={linkClass(false, true)}
                    onClick={() => setMenuOpen(false)}
                  >
                    {link.name}
                    <ExternalIcon />
                  </a>
                );
              }

              const isActive = isNavActive(link.href);
              return (
                <Link
                  key={link.name}
                  href={link.href}
                  className={linkClass(isActive, true)}
                  onClick={() => setMenuOpen(false)}
                >
                  {link.name}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </>
  );
}
