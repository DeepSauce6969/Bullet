"use client";

/**
 * Near-black canvas with faint lime / teal glows that drift very slowly.
 * Chrome stays a lighter charcoal so it lifts off the void.
 */
export function AnimatedBackground() {
  return (
    <div
      aria-hidden="true"
      className="vortex-root pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="vortex-base" />

      <svg
        className="vortex-svg absolute inset-0 h-full w-full"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="lime-blob" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#65ea7e" stopOpacity="0.55" />
            <stop offset="45%" stopColor="#3ccf6a" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="lime-soft" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#65ea7e" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="teal-blob" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#1d6666" stopOpacity="0.5" />
            <stop offset="50%" stopColor="#154d4d" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
          <filter id="mesh-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="42" />
          </filter>
          <filter id="mesh-haze" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="28" />
          </filter>
        </defs>

        {/* Top-right lime — primary, slowest drift */}
        <g className="sky-drift" style={{ animationDuration: "42s" }}>
          <ellipse
            cx="1180"
            cy="160"
            rx="340"
            ry="260"
            fill="url(#lime-blob)"
            filter="url(#mesh-glow)"
            opacity="0.7"
          />
        </g>

        {/* Mid-right smaller lime */}
        <g className="sky-drift-alt" style={{ animationDuration: "36s", animationDelay: "-12s" }}>
          <ellipse
            cx="980"
            cy="380"
            rx="180"
            ry="140"
            fill="url(#lime-soft)"
            filter="url(#mesh-haze)"
            opacity="0.55"
          />
        </g>

        {/* Bottom-left stormy teal */}
        <g className="sky-drift-alt" style={{ animationDuration: "48s", animationDelay: "-8s" }}>
          <ellipse
            cx="180"
            cy="720"
            rx="380"
            ry="280"
            fill="url(#teal-blob)"
            filter="url(#mesh-glow)"
            opacity="0.65"
          />
        </g>

        {/* Bottom-center teal wash */}
        <ellipse
          cx="720"
          cy="860"
          rx="560"
          ry="140"
          fill="url(#teal-blob)"
          filter="url(#mesh-haze)"
          className="sky-pulse"
          opacity="0.45"
        />

        {/* Faint lime threads — barely there */}
        <g
          className="sky-drift"
          fill="none"
          stroke="#65ea7e"
          strokeWidth="1.4"
          opacity="0.14"
          style={{ animationDuration: "52s", animationDelay: "-20s" }}
        >
          <path d="M 980 90 C 1120 40, 1280 160, 1420 110" />
          <path d="M 1080 220 C 1220 180, 1340 280, 1460 240" />
        </g>
      </svg>

      <div className="vortex-grain" />
    </div>
  );
}
