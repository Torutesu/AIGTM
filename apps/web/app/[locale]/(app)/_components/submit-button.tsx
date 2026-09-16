"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Form submit button with a pending state: disables and shows a spinner
 * while the server action runs. Drop-in for plain submit buttons — keeps
 * the same accessible name (spinner is aria-hidden).
 */
export function SubmitButton({
  children,
  className = "",
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      data-testid={testId}
      aria-busy={pending}
      className={`${className} ${pending ? "cursor-wait opacity-70" : ""}`}
    >
      {pending ? <span className="spinner" aria-hidden /> : null}
      {children}
    </button>
  );
}
