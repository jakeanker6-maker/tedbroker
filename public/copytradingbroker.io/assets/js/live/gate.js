// @ts-check
/**
 * Post-sign-in routing gate.
 *
 *   onboarding incomplete            -> /onboarding
 *   questionnaire not answered       -> /onboarding (wizard step after KYC)
 *   onboarding done, not approved    -> /welcome   (placeholder: ID upload is being approved)
 *   onboarding done, access granted  -> /app/
 *
 * Approval is `access_granted`, set by an admin. Signed-out callers get null.
 */
import { api, clearSession, getToken } from './api.js';

/** @returns {Promise<'/onboarding' | '/welcome' | '/app/' | null>} */
export async function resolvePostAuthPath() {
  if (!getToken()) return null;
  const timeout = { signal: AbortSignal.timeout(8000) };
  try {
    const status = await api('/api/onboarding/status', timeout);
    if (!status || typeof status !== 'object') return null;
    if (!status.is_onboarding_complete || !status.questionnaire_completed) return '/onboarding';
    const me = await api('/api/auth/me', timeout);
    return me?.access_granted ? '/app/' : '/welcome';
  } catch (err) {
    // Only an explicit auth rejection ends the session. Other errors are shown as unknown.
    const code = /** @type {any} */ (err)?.status;
    if (code === 401 || code === 403) clearSession();
    return null;
  }
}
