export type DocsNavItem = {
  slug: string;
  label: string;
};

export type DocsNavSection = {
  title: string;
  items: DocsNavItem[];
};

export const DOCS_NAV: DocsNavSection[] = [
  {
    title: "Getting Started",
    items: [
      { slug: "", label: "Overview" },
      { slug: "mechanics", label: "Floor Mechanics" },
    ],
  },
  {
    title: "Products",
    items: [
      { slug: "mint-burn", label: "Mint & Burn" },
      { slug: "loans", label: "Loans & Leverage" },
      { slug: "pre-deposit", label: "Genesis Pre-Deposit" },
    ],
  },
  {
    title: "Reference",
    items: [
      { slug: "fees", label: "Fees & APR" },
      { slug: "contracts", label: "Contracts" },
      { slug: "risks", label: "Risks" },
    ],
  },
];

export function docsHref(slug: string): string {
  return slug ? `/docs/${slug}` : "/docs";
}
