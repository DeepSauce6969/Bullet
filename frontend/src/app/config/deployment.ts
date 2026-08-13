/**
 * Bullet Solana deployment labels (UI badges / hero copy).
 * Program addresses live in `@/lib/bullet`.
 */

export interface DeploymentInfo {
  networkLabel: string;
  statusLabel: string;
  heroSubtitle: string;
  isTestPhase: boolean;
}

export const deployment: DeploymentInfo = {
  networkLabel: "SOLANA DEVNET",
  statusLabel: "ANSEM-BACKED",
  heroSubtitle: "is live on Solana — Ansem-backed",
  isTestPhase: true,
};
