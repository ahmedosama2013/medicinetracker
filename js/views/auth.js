/* Elder-only: "Continue with Google". One button, three states.
 *
 * Everything that happens after the redirect back is handled in js/main.js's
 * boot sequence, since the OAuth round trip reloads the app fresh. What this
 * screen owns is the gap before the redirect -- which on a slow connection is
 * a real second or more of nothing happening -- and the case where the round
 * trip never starts.
 *
 * The error copy follows the handoff rule for every error in the app: say what
 * happened, say that nothing was lost, say what to do next.
 */

import { S } from '../strings.js';
import { el, mount, screen, progressBar, organizerChoice, googleMark } from '../ui.js';
import * as store from '../store.js';

export async function signInView({ app }) {
  let state = 'idle';                 // 'idle' | 'loading' | 'error'

  /* Asked here because there is nowhere better: the household this answer
   * belongs to does not exist yet, and will not until the Google redirect
   * below comes back (see main.js's completeSimpleSignIn). Saved to the local
   * settings immediately on every tap regardless of which way it goes, so it
   * survives that redirect and is simply carried into the household the
   * moment it is created. Defaults to true -- the only behaviour this app has
   * ever had -- so someone who signs in without touching this gets exactly
   * what they always got. */
  let usesOrganizer = (await store.getSettings()).usesOrganizer !== false;

  async function selectOrganizer(value) {
    usesOrganizer = value;
    await store.saveSettings({ usesOrganizer: value });
    draw();
  }

  async function signIn() {
    state = 'loading';
    draw();
    try {
      /* Imported on the tap, not at the top. js/auth.js brings in the full
       * Supabase client, and main.js registers every view up front -- so a
       * static import here meant a supporter device, which can never sign in,
       * downloaded the auth stack to render a screen it never sees. */
      const auth = await import('../auth.js');
      await auth.signInWithGoogle();
      /* Normally unreachable: the call above navigates away. If it returns, the
       * redirect did not happen and the screen must not sit on a progress bar
       * forever. */
    } catch {
      state = 'error';
      draw();
    }
  }

  function body() {
    if (state === 'loading') {
      return el('div.panel', { role: 'status', 'aria-busy': 'true' }, [
        el('span.panel-title', { text: S.signInLoading }),
        progressBar(),
        el('span.panel-note', { text: S.signInLoadingNote }),
      ]);
    }

    if (state === 'error') {
      return el('div.panel.panel-error', { role: 'alert' }, [
        el('span.panel-title', { text: S.signInErrorTitle }),
        el('span.panel-note', { text: S.signInErrorBody }),
        el('button.btn.btn-primary.btn-lg', {
          type: 'button', text: S.tryAgain, onclick: signIn,
        }),
      ]);
    }

    return el('div', { style: 'display: flex; flex-direction: column; gap: 14px' }, [
      el('button.google-btn', { type: 'button', onclick: signIn }, [
        googleMark(),
        el('span', { text: S.signInGoogle }),
      ]),
      el('p.welcome-foot', { text: S.signInNote }),

      el('div', { style: 'margin-top: 8px; display: flex; flex-direction: column; gap: 10px' }, [
        el('span.field-label', { text: S.organizerQuestion }),
        organizerChoice(usesOrganizer, selectOrganizer),
      ]),
    ]);
  }

  function draw() {
    mount(app, screen({
      head: el('div', { style: 'padding: 6px 14px 0' }, [
        el('a.back-btn', { href: '#/welcome', text: S.back }),
      ]),
      body: el('div.signin', [
        el('div', { style: 'display: flex; flex-direction: column; gap: 10px' }, [
          el('h1.signin-title', { text: S.signInTitle }),
          el('p.signin-intro', { text: S.signInIntro }),
        ]),
        body(),
      ]),
    }));
  }

  draw();
}
