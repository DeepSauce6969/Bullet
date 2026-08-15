"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_NAV, docsHref } from "@/app/docs/docs-nav";

export function DocsShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const isActive = (slug: string) => {
    const href = docsHref(slug);
    return pathname === href;
  };

  return (
    <div className="max-w-6xl mx-auto -mt-2">
      <div className="mb-6 space-y-1">
        <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
          Documentation
        </p>
        <h1 className="text-2xl sm:text-3xl font-serif font-black text-[var(--foreground)]">
          {title}
        </h1>
        {description && (
          <p className="text-sm font-mono text-[var(--muted)] max-w-2xl">
            {description}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-6 lg:gap-8">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <nav className="slvr-card bank-card p-3 space-y-4 font-mono text-[11px]">
            {DOCS_NAV.map((section) => (
              <div key={section.title}>
                <p className="px-2 mb-1.5 text-[9px] uppercase tracking-widest text-[var(--muted)] font-bold">
                  {section.title}
                </p>
                <ul className="space-y-0.5">
                  {section.items.map((item) => {
                    const href = docsHref(item.slug);
                    const active = isActive(item.slug);
                    return (
                      <li key={item.slug || "overview"}>
                        <Link
                          href={href}
                          className={`block px-2.5 py-2 rounded-lg transition-colors btn-haptic ${
                            active
                              ? "bg-gradient-to-r from-[var(--accent)] to-[var(--accent-dark)] text-[var(--accent-foreground)] font-bold"
                              : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--inset)]/60"
                          }`}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <article className="slvr-card bank-card p-5 sm:p-7 docs-prose min-w-0">
          {children}
        </article>
      </div>
    </div>
  );
}
