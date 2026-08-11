export const ROUTES = {
  home: '/',
  login: '/login',
  signup: '/signup',
  dashboard: '/dashboard',
  emailConfirmCallback: '/auth/confirm',
} as const;

/** Everything under these prefixes requires a signed-in user. */
const PROTECTED_PATH_PREFIXES = ['/dashboard'] as const;

/** Pages a signed-in user has no reason to see. */
const AUTH_PATHS = [ROUTES.login, ROUTES.signup] as const;

export function getIsProtectedPath(pathname: string): boolean {
  return PROTECTED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function getIsAuthPath(pathname: string): boolean {
  return AUTH_PATHS.some((path) => pathname === path);
}

/**
 * Turns a `?redirectTo=` value into a path we are willing to send a browser to.
 *
 * Only same-site absolute paths are accepted. Anything else — a full URL, a
 * protocol-relative `//evil.example`, a backslash variant that some browsers
 * normalise to `//`, or a value carrying control characters — falls back to the
 * dashboard, so this parameter can never be used to bounce a freshly
 * signed-in user off to an attacker's page.
 */
export function sanitizeRedirectPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/')) {
    return ROUTES.dashboard;
  }

  if (value.startsWith('//') || value.startsWith('/\\')) {
    return ROUTES.dashboard;
  }

  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return ROUTES.dashboard;
  }

  return value;
}
