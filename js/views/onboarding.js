/* First run: which of the two people is holding this phone.
 *
 * Asked as a plain question with two plain answers. The roles are never named
 * on screen - "elder" reads badly to the person being called it - and the
 * choice is reversible from Settings, so nobody is trapped by a wrong tap.
 *
 * "I take the medicines" leads to a Google sign-in (this account owns the
 * household). "I help someone" leads straight to a code-entry screen with no
 * sign-in at all -- see js/views/auth.js and js/views/pairing.js.
 */

import { S } from '../strings.js';
import { el, clear } from '../ui.js';

export async function welcomeView({ app }) {
  clear(app);

  app.appendChild(el('div.welcome', [
    el('h1.welcome-title', { text: S.welcomeTitle }),
    el('p.welcome-intro', { text: S.welcomeIntro }),

    el('a.role-btn', { href: '#/signin' }, [
      el('span.role-name', { text: S.roleSimple }),
      el('span.role-hint', { text: S.roleSimpleHint }),
    ]),

    el('a.role-btn', { href: '#/pair' }, [
      el('span.role-name', { text: S.roleSupporter }),
      el('span.role-hint', { text: S.roleSupporterHint }),
    ]),

    el('p.welcome-foot', { text: S.roleChangeLater }),
  ]));
}
