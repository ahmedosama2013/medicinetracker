/* First run: which of the two people is holding this phone.
 *
 * Asked as a plain question with two plain answers. The roles are never named
 * on screen - "elder" reads badly to the person being called it - and the
 * choice is reversible from Settings, so nobody is trapped by a wrong tap.
 */

import * as store from '../store.js';
import * as router from '../router.js';
import { S } from '../strings.js';
import { el, clear } from '../ui.js';

async function choose(role) {
  await store.saveSettings({ role });
  // A mode switch changes navigation, route ownership and the whole type
  // scale. Reloading is simpler and less bug-prone than re-theming live.
  window.location.replace(`#${router.HOME[role].slice(1)}`);
  window.location.reload();
}

export async function welcomeView({ app }) {
  clear(app);

  app.appendChild(el('div.welcome', [
    el('h1.welcome-title', { text: S.welcomeTitle }),
    el('p.welcome-intro', { text: S.welcomeIntro }),

    el('button.role-btn', { type: 'button', onclick: () => choose('simple') }, [
      el('span.role-name', { text: S.roleSimple }),
      el('span.role-hint', { text: S.roleSimpleHint }),
    ]),

    el('button.role-btn', { type: 'button', onclick: () => choose('supporter') }, [
      el('span.role-name', { text: S.roleSupporter }),
      el('span.role-hint', { text: S.roleSupporterHint }),
    ]),

    el('p.welcome-foot', { text: S.roleChangeLater }),
  ]));
}
