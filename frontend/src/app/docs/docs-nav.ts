export type DocsNavItem = {
  id: string;
  label: string;
};

export type DocsNavSection = {
  title: string;
  items: DocsNavItem[];
};

/** Anchor targets on the single-page /docs route (PONS-style). */
export const DOCS_NAV: DocsNavSection[] = [
  {
    title: "Introduction",
    items: [{ id: "overview", label: "Overview" }],
  },
  {
    title: "Protocol",
    items: [
      { id: "mechanics", label: "Floor mechanics" },
      { id: "mint-burn", label: "Mint & burn" },
      { id: "loans", label: "Loans & leverage" },
      { id: "pre-deposit", label: "Genesis pre-deposit" },
    ],
  },
  {
    title: "Reference",
    items: [
      { id: "fees", label: "Fees & APR" },
      { id: "contracts", label: "Contracts" },
      { id: "risks", label: "Risk disclosures" },
    ],
  },
];

export const DOCS_SECTION_IDS = DOCS_NAV.flatMap((s) =>
  s.items.map((i) => i.id)
);
