/**
 * Patch frontend hardcoded addresses from deployed-devnet.json.
 * Usage: npx tsx scripts/sync-frontend-addresses.ts
 */
import * as fs from "fs";
import * as path from "path";

const root = path.join(__dirname, "..");
const deployed = JSON.parse(
  fs.readFileSync(path.join(root, "deployed-devnet.json"), "utf8")
);

function patchFile(
  rel: string,
  replacements: { find: RegExp; replace: string; label: string }[]
) {
  const p = path.join(root, rel);
  let src = fs.readFileSync(p, "utf8");
  for (const r of replacements) {
    if (!r.find.test(src)) {
      console.warn(`WARN ${rel}: pattern not found for ${r.label}`);
      continue;
    }
    src = src.replace(r.find, r.replace);
    console.log(`patched ${rel}: ${r.label}`);
  }
  fs.writeFileSync(p, src);
}

patchFile("frontend/src/lib/bullet.ts", [
  {
    label: "PROGRAM_ID",
    find: /export const PROGRAM_ID = new PublicKey\(\s*"[^"]+"\s*\)/,
    replace: `export const PROGRAM_ID = new PublicKey(\n  "${deployed.programId}"\n)`,
  },
  {
    label: "ANSEM_MINT",
    find: /export const ANSEM_MINT = new PublicKey\(\s*"[^"]+"\s*\)/,
    replace: `export const ANSEM_MINT = new PublicKey(\n  "${deployed.ansemMint}"\n)`,
  },
  {
    label: "PROTOCOL_PDA",
    find: /export const PROTOCOL_PDA = new PublicKey\(\s*"[^"]+"\s*\)/,
    replace: `export const PROTOCOL_PDA = new PublicKey(\n  "${deployed.protocol}"\n)`,
  },
  {
    label: "BULLET_MINT",
    find: /export const BULLET_MINT = new PublicKey\(\s*"[^"]+"\s*\)/,
    replace: `export const BULLET_MINT = new PublicKey(\n  "${deployed.bulletMint}"\n)`,
  },
  {
    label: "VAULT",
    find: /export const VAULT = new PublicKey\("[^"]+"\)/,
    replace: `export const VAULT = new PublicKey("${deployed.vault}")`,
  },
  {
    label: "POL_VAULT",
    find: /export const POL_VAULT = new PublicKey\(\s*"[^"]+"\s*\)/,
    replace: `export const POL_VAULT = new PublicKey(\n  "${deployed.polVault}"\n)`,
  },
  {
    label: "COLLATERAL_VAULT",
    find: /export const COLLATERAL_VAULT = new PublicKey\(\s*"[^"]+"\s*\)/,
    replace: `export const COLLATERAL_VAULT = new PublicKey(\n  "${deployed.collateralVault}"\n)`,
  },
  {
    label: "FEE_RECIPIENT",
    find: /export const FEE_RECIPIENT = new PublicKey\(\s*"[^"]+"\s*\)/,
    replace: `export const FEE_RECIPIENT = new PublicKey(\n  "${deployed.feeRecipient}"\n)`,
  },
]);

patchFile("frontend/src/app/api/faucet/route.ts", [
  {
    label: "ANSEM_MINT",
    find: /const ANSEM_MINT = new PublicKey\(\s*"[^"]+"\s*\)/,
    replace: `const ANSEM_MINT = new PublicKey(\n  "${deployed.ansemMint}"\n)`,
  },
]);

console.log("Frontend addresses synced from deployed-devnet.json");
console.log(JSON.stringify({
  programId: deployed.programId,
  ansemMint: deployed.ansemMint,
  protocol: deployed.protocol,
  feeRecipient: deployed.feeRecipient,
}, null, 2));
