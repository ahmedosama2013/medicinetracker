/* Simple-only: "Sign in with Google". One button; everything that happens
 * after the redirect back is handled in js/main.js's boot sequence, since
 * the OAuth round trip reloads the app fresh. */

import * as auth from '../auth.js';
import { S } from '../strings.js';
import { el, clear, toast } from '../ui.js';

export async function signInView({ app }) {
  clear(app);
  app.appendChild(el('div.welcome', [
    el('h1.welcome-title', { text: S.signInTitle }),
    el('p.welcome-intro', { text: S.signInIntro }),
    el('button.role-btn', {
      type: 'button',
      onclick: async () => {
        try {
          await auth.signInWithGoogle();
        } catch {
          toast(S.errGeneric);
        }
      },
    }, [
      el('span.role-name', { text: S.signInGoogle }),
    ]),
    el('a.welcome-foot', { href: '#/welcome', text: S.back }),
  ]));
}
