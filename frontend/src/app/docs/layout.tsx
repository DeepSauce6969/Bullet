import { DocsSidebar } from "@/app/docs/components/DocsSidebar";
import { DocsMobileNav } from "@/app/docs/components/DocsMobileNav";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="docs-root">
      <DocsMobileNav />

      <div className="docs-frame">
        <DocsSidebar />
        <div className="docs-main">{children}</div>
      </div>
    </div>
  );
}
