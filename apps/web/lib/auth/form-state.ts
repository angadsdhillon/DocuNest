import type { CredentialFieldErrors } from '@/lib/auth/validation';

export type AuthFormState = {
  /** Something wrong with the submission as a whole. */
  formError: string | null;
  /** Per-field messages shown under the matching input. */
  fieldErrors: CredentialFieldErrors;
  /** Neutral information, e.g. "check your email to finish signing up". */
  notice: string | null;
  /**
   * Set only after a successful sign-in. The client navigates here instead of
   * relying on `redirect()` inside the server action, which does not settle
   * when the form is submitted through a manual `await`.
   */
  redirectTo?: string;
};

export const EMPTY_AUTH_FORM_STATE: AuthFormState = {
  formError: null,
  fieldErrors: {},
  notice: null,
};
