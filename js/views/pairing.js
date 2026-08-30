/* Supporter: enter the household's share code. No account, no sign-in --
 * the code itself is validated by loading the routine it unlocks, then
 * stored on this device the same way the local `role` always has been. */

import * as store from '../store.js';
import * as supporter from '../supporter.js';
import * as router from '../router.js';
import { S } from '../strings.js';
import { el, clear, field, toast } from '../ui.js';

export async function pairView({ app }) {
  clear(app);
  let code = '';
  let error = null;
  let busy = false;

  function draw() {
    clear(app);
    app.appendChild(el('div.welcome', [
      el('h1.welcome-title', { text: S.pairTitle }),
      el('p.welcome-intro', { text: S.pairIntro }),
      field({
        id: 'pair-code',
        label: S.pairCodeLabel,
        error,
        control: el('input', {
          type: 'text',
          id: 'pair-code',
          value: code,
          autocomplete: 'off',
          autocapitalize: 'characters',
          placeholder: 'ABC123',
          class: error ? 'input-invalid' : '',
          oninput: e => { code = e.target.value; },
        }),
      }),
      el('button.btn.btn-primary.btn-block', {
        type: 'button',
        text: busy ? S.loading : S.pairConnect,
        disabled: busy,
        onclick: connect,
      }),
      el('a.welcome-foot', { href: '#/welcome', text: S.back }),
    ]));
  }

  async function connect() {
    if (!code.trim()) { error = S.pairCodeRequired; draw(); return; }
    busy = true;
    error = null;
    draw();
    try {
      const routine = await supporter.loadRoutine(code);
      await store.saveSettings({
        role: 'supporter',
        supporterCode: code.trim(),
        supporterHouseholdName: routine.household?.displayName || '',
      });
      window.location.replace(router.HOME.supporter);
      window.location.reload();
    } catch {
      busy = false;
      error = S.pairCodeInvalid;
      draw();
    }
  }

  draw();
}
