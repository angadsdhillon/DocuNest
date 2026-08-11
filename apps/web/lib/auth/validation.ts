import { z } from 'zod';

/**
 * Minimum password length the app asks for. This is a UX guardrail only — the
 * binding rule lives in the Supabase project's own auth settings, which reject
 * short passwords no matter what any client sends. Keep the two in step: if
 * you change this, change "Minimum password length" in the Supabase dashboard
 * under Authentication → Sign In / Providers → Email too.
 */
export const MINIMUM_PASSWORD_LENGTH = 10;

/**
 * Supabase hashes passwords with bcrypt, which ignores anything past 72 bytes.
 * Rejecting longer input is honest rather than silently truncating it.
 */
const MAXIMUM_PASSWORD_LENGTH = 72;

export const credentialsSchema = z.object({
  email: z
    .email('Enter an email address that looks like name@example.com.')
    .max(254, 'That email address is too long.'),
  password: z
    .string()
    .min(
      MINIMUM_PASSWORD_LENGTH,
      `Use at least ${MINIMUM_PASSWORD_LENGTH} characters for your password.`,
    )
    .max(MAXIMUM_PASSWORD_LENGTH, 'Passwords can be at most 72 characters.'),
});

export type Credentials = z.infer<typeof credentialsSchema>;

export type CredentialFieldErrors = Partial<Record<keyof Credentials, string>>;

/**
 * Pulls the two fields out of a form and normalises them the same way on the
 * client and on the server, so both sides validate exactly what gets sent.
 */
export function readCredentialsFromForm(formData: FormData): Credentials {
  const email = formData.get('email');
  const password = formData.get('password');

  return {
    email: typeof email === 'string' ? email.trim().toLowerCase() : '',
    password: typeof password === 'string' ? password : '',
  };
}

export function validateCredentials(
  credentials: Credentials,
): { isValid: true } | { isValid: false; fieldErrors: CredentialFieldErrors } {
  const result = credentialsSchema.safeParse(credentials);

  if (result.success) {
    return { isValid: true };
  }

  const fieldErrors: CredentialFieldErrors = {};

  for (const issue of result.error.issues) {
    const field = issue.path[0];

    if ((field === 'email' || field === 'password') && !fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
  }

  return { isValid: false, fieldErrors };
}
