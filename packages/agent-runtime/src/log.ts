/**
 * Structured JSON logging — one line per event on stdout, ready for log
 * sinks (Datadog/CloudWatch/Loki all ingest this shape). Levels: info for
 * lifecycle, warn for failures. Never log prompts, outputs, or secrets.
 */
export function logEvent(
  event: string,
  fields: Record<string, unknown> = {},
  level: "info" | "warn" = "info",
) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === "warn") console.warn(line);
  else console.log(line);
}
