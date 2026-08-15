"use client";

export function DocsMobileNav() {
  return (
    <div className="docs-mobile-bar lg:hidden">
      <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
        Jump to section
      </p>
      <select
        className="docs-mobile-select"
        defaultValue="overview"
        onChange={(e) => {
          const el = document.getElementById(e.target.value);
          el?.scrollIntoView({ behavior: "smooth" });
        }}
      >
        <option value="overview">Overview</option>
        <option value="mechanics">Floor mechanics</option>
        <option value="mint-burn">Mint & burn</option>
        <option value="loans">Loans & leverage</option>
        <option value="pre-deposit">Genesis pre-deposit</option>
        <option value="fees">Fees & APR</option>
        <option value="contracts">Contracts</option>
        <option value="risks">Risk disclosures</option>
      </select>
    </div>
  );
}
