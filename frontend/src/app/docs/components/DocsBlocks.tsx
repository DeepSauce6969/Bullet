import type { ReactNode } from "react";

export function DocsHero({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <header className="docs-hero">
      <p className="docs-eyebrow">bullet docs</p>
      <h1 className="docs-hero-title">{title}</h1>
      <p className="docs-hero-subtitle">{subtitle}</p>
    </header>
  );
}

export function DocsSection({
  id,
  title,
  children,
  kicker,
}: {
  id: string;
  title: string;
  children: ReactNode;
  kicker?: string;
}) {
  return (
    <section
      id={id}
      data-docs-section
      className="docs-section scroll-mt-28"
    >
      {kicker && <p className="docs-section-kicker">{kicker}</p>}
      <h2 className="docs-section-title">{title}</h2>
      <div className="docs-section-body">{children}</div>
    </section>
  );
}

export function DocsKeyFacts({ children }: { children: ReactNode }) {
  return (
    <div className="docs-key-facts">
      <p className="docs-key-facts-label">Key facts</p>
      <ul>{children}</ul>
    </div>
  );
}

export function DocsSteps({
  steps,
}: {
  steps: { title: string; body: string }[];
}) {
  return (
    <div className="docs-steps">
      {steps.map((step, i) => (
        <div key={step.title} className="docs-step">
          <span className="docs-step-num">
            {String(i + 1).padStart(2, "0")}
          </span>
          <h3>{step.title}</h3>
          <p>{step.body}</p>
        </div>
      ))}
    </div>
  );
}

export function DocsDefGrid({
  items,
}: {
  items: { term: string; definition: string }[];
}) {
  return (
    <dl className="docs-def-grid">
      {items.map((item) => (
        <div key={item.term} className="docs-def-item">
          <dt>{item.term}</dt>
          <dd>{item.definition}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DocsCallout({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="docs-callout-block">
      {title && <p className="docs-callout-title">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

export function DocsCodeBlock({
  title,
  children,
}: {
  title?: string;
  children: string;
}) {
  return (
    <div className="docs-code-wrap">
      {title && <p className="docs-code-title">{title}</p>}
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}

export function DocsAddressRow({
  label,
  address,
}: {
  label: string;
  address: string;
}) {
  return (
    <div className="docs-address-row">
      <span className="docs-address-label">{label}</span>
      <code className="docs-address-value">{address}</code>
    </div>
  );
}
