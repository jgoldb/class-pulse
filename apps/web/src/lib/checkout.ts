/**
 * The paid checkout id has to survive Clerk's part of the sign-up.
 *
 * Clerk owns the URL between `/sign-up` and `/sign-up/verify-email-address`, and because the
 * provider is not wired to the router it navigates with a full page load: the `?checkout=` we
 * put on `/sign-up` is dropped, `SignUpPage` re-mounts without it, and a paying customer would
 * land on `/onboarding` with no checkout id — the "invitation-based" dead end. So the checkout
 * page parks the id here when it hands off, and `SignUpPage` / `Onboarding` read it back when
 * the query parameter is missing.
 *
 * This is a pointer, not an entitlement. `POST /api/onboarding/workspace` still refuses any
 * checkout session that is not `paid` and unclaimed, so a remembered id grants nothing.
 * Session storage, not local storage: it belongs to the tab that did the paying.
 */
const KEY = 'cp.checkout';

export function rememberCheckout(id: string) {
  try {
    sessionStorage.setItem(KEY, id);
  } catch {
    /* storage unavailable */
  }
}

export function recallCheckout(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetCheckout() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
