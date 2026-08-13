"use client";

/**
 * Mesh-glow SVG background — Light Green (#65ea7e) + Stormy Teal (#1d6666)
 * on Chaos Black (#0f0f0f).
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
          <linearGradient id="lime-core" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#65ea7e" stopOpacity="0.9" />
            <stop offset="45%" stopColor="#3ccf6a" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#0f0f0f" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="teal-soft" x1="0%" y1="20%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1d6666" stopOpacity="0.85" />
            <stop offset="50%" stopColor="#154d4d" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#0f0f0f" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="teal-rim" x1="0%" y1="50%" x2="100%" y2="50%">
            <stop offset="0%" stopColor="#1d6666" stopOpacity="0" />
            <stop offset="40%" stopColor="#1d6666" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#1d6666" stopOpacity="0" />
          </linearGradient>
          <filter id="mesh-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="28" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="mesh-soft-blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="18" />
          </filter>
        </defs>

        {/* Left stormy teal swirl */}
        <g className="sky-drift" style={{ animationDelay: "0s" }}>
          <path
            d="M -80 120 L 420 460 L -40 820 Z"
            fill="url(#teal-soft)"
            filter="url(#mesh-glow)"
            opacity="0.9"
          />
          <path
            d="M 40 200 L 360 450 L 60 720 Z"
            fill="#1d6666"
            filter="url(#mesh-soft-blur)"
            opacity="0.4"
          />
        </g>

        {/* Right lime glow */}
        <g className="sky-drift" style={{ animationDelay: "-6s" }}>
          <path
            d="M 720 180
               C 860 120, 980 220, 1080 280
               C 1200 360, 1320 420, 1480 380
               L 1500 900 L 700 920
               C 760 720, 700 560, 780 420
               C 820 320, 700 240, 720 180 Z"
            fill="url(#lime-core)"
            filter="url(#mesh-glow)"
            opacity="0.85"
          />
          <path
            d="M 860 260
               C 980 210, 1100 300, 1220 340
               C 1320 370, 1400 400, 1480 360
               L 1480 700
               C 1280 640, 1120 580, 980 520
               C 880 470, 820 360, 860 260 Z"
            fill="#65ea7e"
            filter="url(#mesh-soft-blur)"
            opacity="0.32"
          />
        </g>

        <ellipse
          cx="720"
          cy="780"
          rx="640"
          ry="120"
          fill="url(#teal-rim)"
          className="sky-pulse"
        />

        <g fill="none" stroke="#65ea7e" strokeWidth="1.2" opacity="0.18">
          <path d="M 120 300 C 280 240, 360 380, 520 340" />
          <path d="M 980 220 C 1120 180, 1240 300, 1380 260" />
          <path d="M 200 620 C 380 560, 520 700, 700 640" />
        </g>
      </svg>

      <div className="vortex-grain" />
    </div>
  );
}
