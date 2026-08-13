import { redirect } from "next/navigation";

/** Alias route — Mint & Burn lives at /mint-and-burn */
export default function SwapPage() {
  redirect("/mint-and-burn");
}
