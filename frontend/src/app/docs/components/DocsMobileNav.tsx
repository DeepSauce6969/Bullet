"use client";

import { useEffect, useRef, useState } from "react";
import { DOCS_NAV } from "@/app/docs/docs-nav";

const SECTIONS = DOCS_NAV.flatMap((section) => section.items);

export function DocsMobileNav() {
  const [open, setOpen] = useState(false);
  const [currentId, setCurrentId] = useState(SECTIONS[0]?.id ?? "overview");
  const rootRef = useRef<HTMLDivElement>(null);

  const current =
    SECTIONS.find((item) => item.id === currentId) ?? SECTIONS[0];

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const jumpTo = (id: string) => {
    setCurrentId(id);
    setOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="docs-mobile-bar lg:hidden">
      <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
        Jump to section
      </p>
      <div ref={rootRef} className="relative">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="docs-mobile-select flex w-full items-center justify-between text-left"
        >
          <span>{current?.label}</span>
          <svg
            className={`h-3.5 w-3.5 shrink-0 text-[var(--muted)] transition-transform ${
              open ? "rotate-180" : ""
            }`}
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
          >
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {open && (
          <ul
            role="listbox"
            aria-label="Documentation sections"
            className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-white/5 bg-[var(--deep)] py-1 shadow-xl"
          >
            {SECTIONS.map((item) => {
              const selected = item.id === currentId;
              return (
                <li key={item.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => jumpTo(item.id)}
                    className={`w-full px-3 py-2 text-left text-xs font-mono transition-colors ${
                      selected
                        ? "bg-[var(--accent-dark)] text-white"
                        : "text-[var(--foreground)] hover:bg-[var(--accent-dark)] hover:text-white"
                    }`}
                  >
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
