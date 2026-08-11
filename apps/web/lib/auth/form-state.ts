import type { CredentialFieldErrors } from '@/lib/auth/validation';

export type AuthFormState = {
  /** Something wrong with the submission as a whole. */
  formError: string | null;
  /** Per-field messages shown under the matching input. */
  fieldErrors: CredentialFieldErrors;
  /** Neutral information, e.g. "check your email to finish signing up". */
  notice: string | null;
};

export const EMPTY_AUTH_FORM_STATE: AuthFormState = {
  formError: null,
  fieldErrors: {},
  notice: null,
};
