"use client";

/**
 * Submit button that asks window.confirm before posting — for
 * irreversible actions (GDPR erasure). Use inside a <form>; the form's
 * hidden inputs carry the payload.
 */
export function ConfirmButton({
  message,
  children,
  className,
  testId,
}: {
  message: string;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <button
      type="submit"
      data-testid={testId}
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
