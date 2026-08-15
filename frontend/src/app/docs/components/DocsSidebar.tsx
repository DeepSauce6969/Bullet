"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DOCS_NAV } from "@/app/docs/docs-nav";

export function DocsSidebar() {
  const [activeId, setActiveId] = useState("overview");

  useEffect(() => {
    const sections = document.querySelectorAll<HTMLElement>("[data-docs-section]");
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target.id) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0, 0.25, 0.5, 1] }
    );

    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <aside className="docs-sidebar hidden lg:flex lg:w-[280px] lg:shrink-0 lg:sticky lg:top-[4.5rem] lg:h-[calc(100vh-4.5rem)] lg:py-4 lg:pl-4 lg:pr-3">
      <div className="flex flex-col min-h-0 w-full bg-[var(--deep)] p-6 rounded-2xl border border-white/5">
        <div className="pb-4 mb-4 border-b border-white/5">
          <Link href="/" className="inline-flex items-center gap-2 btn-haptic">
            <Image
              src="/BULLET-LOGO.png"
              alt="Bullet"
              width={120}
              height={36}
              className="h-7 w-auto object-contain"
            />
          </Link>
          <p className="mt-3 text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--muted)]">
            Documentation
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto space-y-5 font-mono text-[11px] pr-1">
          {DOCS_NAV.map((section) => (
            <div key={section.title}>
              <p className="px-2 mb-2 text-[9px] uppercase tracking-[0.18em] text-[var(--muted)] font-bold">
                {section.title}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = activeId === item.id;
                  return (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        className={`docs-sidebar-link ${active ? "is-active" : ""}`}
                      >
                        {item.label}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="pt-4 mt-4 border-t border-white/5">
          <Link
            href="/mint-and-burn"
            className="flex items-center justify-center w-full py-2.5 rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-dark)] text-[var(--accent-foreground)] text-[10px] font-bold tracking-wider btn-haptic"
          >
            OPEN APP
          </Link>
        </div>
      </div>
    </aside>
  );
}
