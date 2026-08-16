/**
 * The one place the worker writes to stdout/stderr, so "never log document
 * content, filenames, or email bodies" is enforced by API shape rather than
 * by every call site remembering the rule. Every helper here takes only
 * ids, statuses, byte counts and timestamps — there is no parameter that
 * accepts free-text document content, so a call site would have to fight
 * the type system to leak it.
 */

export type LogFields = Record<string, string | number | boolean | null>;

function formatFields(fields?: LogFields): string {
  if (!fields || Object.keys(fields).length === 0) {
    return '';
  }

  const rendered = Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');

  return ` (${rendered})`;
}

export function logInfo(message: string, fields?: LogFields): void {
  console.log(`[worker] ${message}${formatFields(fields)}`);
}

export function logWarn(message: string, fields?: LogFields): void {
  console.warn(`[worker] ${message}${formatFields(fields)}`);
}

export function logError(
  message: string,
  error: unknown,
  fields?: LogFields,
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`[worker] ${message}: ${errorMessage}${formatFields(fields)}`);
}
