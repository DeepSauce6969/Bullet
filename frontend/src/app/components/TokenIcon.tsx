"use client";

import React from "react";
import Image from "next/image";

interface TokenIconProps {
  symbol?: string;
  className?: string;
}

export function TokenIcon({ symbol = "ANSEM", className = "" }: TokenIconProps) {
  const isBullet = symbol.toUpperCase() === "BULLET";
  return (
    <Image
      src={isBullet ? "/BULLET.png" : "/ansem-logo.png"}
      alt={isBullet ? "BULLET" : "ANSEM"}
      width={22}
      height={22}
      className={`token-icon ${className}`}
      aria-hidden="true"
    />
  );
}
