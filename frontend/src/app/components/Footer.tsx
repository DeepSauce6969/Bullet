"use client";

import Link from "next/link";
import Image from "next/image";

export function Footer() {
  return (
    <footer className="mt-auto w-full border-t border-[var(--card-border)]/40 bg-[var(--deep)]/85 py-6 px-6 sm:px-8 font-mono text-xs relative z-20 backdrop-blur-md">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center h-8 btn-haptic">
            <Image
              src="/BULLET-LOGO.png"
              alt="Bullet Logo"
              width={250}
              height={80}
              className="h-8 w-auto object-contain rounded-sm"
            />
          </Link>
          <span className="text-[var(--muted)] text-[11px]">
            © {new Date().getFullYear()} Bullet Protocol
          </span>
        </div>

        <div className="flex items-center gap-4 text-[var(--foreground)] font-semibold">
          <a
            href="https://x.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--accent-dark)] transition btn-haptic"
          >
            Twitter / X
          </a>
        </div>
      </div>
    </footer>
  );
}
