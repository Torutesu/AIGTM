import { cookies } from "next/headers";

export const TOAST_COOKIE = "aigtm_toast";

/** Keys must exist in messages/*.json under "toast". */
const KEYS = new Set([
  "approved",
  "dismissed",
  "runStarted",
  "retried",
  "cancelled",
  "segmentCreated",
  "segmentUpdated",
  "segmentDeleted",
  "memberAdded",
  "memberRemoved",
  "roleChanged",
  "signedIn",
  "keySaved",
  "keyRemoved",
  "routingSaved",
  "ingestRevoked",
  "integrationsSaved",
  "budgetSaved",
]);

/** Set a one-shot toast consumed by ToastHub on the next render. */
export async function flash(key: string) {
  if (!KEYS.has(key)) return;
  const store = await cookies();
  store.set(TOAST_COOKIE, key, { path: "/", maxAge: 15 });
}

export async function readToast(): Promise<string | null> {
  const store = await cookies();
  const v = store.get(TOAST_COOKIE)?.value ?? null;
  return v && KEYS.has(v) ? v : null;
}
