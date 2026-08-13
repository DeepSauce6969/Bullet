import { toast } from "sonner";
import { EXPLORER_TX } from "@/lib/bullet";

export type ToastId = string | number;

/** Known revert / wallet error patterns → user-facing label */
const REVERT_HINTS: Array<{ match: RegExp; label: string }> = [
  { match: /insufficient\s*(funds|balance|allowance)/i, label: "Insufficient funds" },
  { match: /transfer amount exceeds balance/i, label: "Insufficient funds" },
  { match: /not\s*whitelisted|invalid\s*proof|merkle|not\s*eligible/i, label: "Not whitelisted" },
  { match: /cap\s*reached|deposit\s*cap|exceeds?\s*(the\s*)?cap|allocation/i, label: "Cap reached" },
  { match: /user\s*rejected|denied|rejected the request/i, label: "Transaction rejected in wallet" },
  { match: /wrong\s*network|unsupported chain/i, label: "Wrong network" },
];

function collectErrorText(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (typeof err !== "object") return String(err);

  const o = err as Record<string, unknown>;
  const parts: string[] = [];

  for (const key of ["shortMessage", "message", "details", "reason", "name"] as const) {
    if (typeof o[key] === "string") parts.push(o[key] as string);
  }

  if (Array.isArray(o.metaMessages)) {
    parts.push(...o.metaMessages.filter((m): m is string => typeof m === "string"));
  }

  if (o.cause) parts.push(collectErrorText(o.cause));

  return parts.join(" | ");
}

export function parseContractError(err: unknown): {
  message: string;
  hint: string | null;
  raw: string;
  details: Record<string, unknown>;
} {
  const raw = collectErrorText(err);
  const hint = REVERT_HINTS.find(({ match }) => match.test(raw))?.label ?? null;

  const o = err && typeof err === "object" ? (err as Record<string, unknown>) : null;

  const details: Record<string, unknown> = {
    hint,
    raw,
    name: o?.name,
    message: o?.message,
    code: o?.code,
  };

  const message =
    hint ??
    (typeof o?.message === "string"
      ? o.message
      : raw.split(" | ")[0] || "Transaction failed.");

  return { message, hint, raw, details };
}

export const showTxToast = {
  loading: (message: string, id?: ToastId): ToastId => {
    const toastId = id ?? `tx-${Date.now()}`;
    toast.loading(message, { id: toastId });
    return toastId;
  },

  info: (message: string, id?: ToastId) => {
    if (id !== undefined) toast.info(message, { id });
    else toast.info(message);
  },

  success: (message: string, txHash?: string, id?: ToastId) => {
    const opts: Parameters<typeof toast.success>[1] = id !== undefined ? { id } : {};
    if (txHash) {
      toast.success(message, {
        ...opts,
        action: {
          label: "View on Explorer ↗",
          onClick: () => window.open(EXPLORER_TX(txHash), "_blank"),
        },
      });
    } else {
      toast.success(message, opts);
    }
  },

  error: (message: string, id?: ToastId) => {
    if (id !== undefined) toast.error(message, { id });
    else toast.error(message);
  },

  dismiss: (id?: ToastId) => {
    toast.dismiss(id);
  },
};
