/* First run: which of the two people is holding this phone — and the
 * read-only "How it works" carousel, reachable from here and from both
 * Settings screens.
 *
 * The role question is asked as a plain question with two plain answers, and
 * nothing else on the screen competes with them. The roles are never named on
 * screen ("elder" reads badly to the person being called it) and the choice is
 * reversible from Settings, so nobody is trapped by a wrong tap.
 */

import { S } from '../strings.js';
import { el, mount, screen } from '../ui.js';
import { go } from '../router.js';

/* The 190px illustration slot, one per carousel step. Line drawings rather
 * than the prototype's hatch placeholder: the panel is a third of the screen
 * and a hatch there reads as a broken image, not as a pending asset. They are
 * decorative — every step's meaning is carried by its title and body. */
const HOW_ART = {
  role: '<svg viewBox="0 0 320 176" aria-hidden="true"><path class="how-line" d="M160 64v22M160 86C160 108 91 96 91 126M160 86c0 22 69 10 69 40"/><g class="how-node how-node-main"><circle cx="160" cy="43" r="31"/><path d="m146 31 28 28M139 38l14-14a10 10 0 0 1 14 0l17 17a10 10 0 0 1 0 14l-14 14a10 10 0 0 1-14 0l-17-17a10 10 0 0 1 0-14Z"/></g><g class="how-node how-node-blue"><circle cx="91" cy="137" r="29"/><path d="m77 137 9 9 19-20"/></g><g class="how-node how-node-teal"><circle cx="229" cy="137" r="29"/><circle cx="220" cy="137" r="10"/><circle cx="238" cy="137" r="10"/></g></svg>',
  setup: '<svg viewBox="0 0 320 176" aria-hidden="true"><g class="how-photo"><rect x="28" y="31" width="106" height="106" rx="24"/><path d="m65 78 34 34M55 88l18-18a12 12 0 0 1 17 0l18 18a12 12 0 0 1 0 17l-18 18a12 12 0 0 1-17 0l-18-18a12 12 0 0 1 0-17Z"/><circle cx="116" cy="49" r="13"/><path d="m110 49 4 4 8-9"/></g><path class="how-arrow" d="M150 84h34m-10-10 10 10-10 10"/><g class="how-schedule"><circle cx="235" cy="84" r="48"/><circle cx="235" cy="84" r="22"/><path d="M235 69v16l11 8"/><path class="how-ray" d="M235 21v8M235 139v8M172 84h8M290 84h8"/></g></svg>',
  today: '<svg viewBox="0 0 320 176" aria-hidden="true"><path class="how-line" d="M103 88h44M173 88h42"/><g class="how-pill-photo"><circle cx="66" cy="88" r="42"/><path d="m50 72 32 32M43 79l15-15a11 11 0 0 1 16 0l16 16a11 11 0 0 1 0 16l-15 15a11 11 0 0 1-16 0L43 95a11 11 0 0 1 0-16Z"/></g><g class="how-done"><circle cx="160" cy="88" r="28"/><path d="m147 88 9 9 18-21"/></g><g class="how-bell"><circle cx="254" cy="88" r="42"/><path d="M238 98h32l-5-7V79c0-8-5-14-11-14s-11 6-11 14v12l-5 7Zm11 7h10"/><path class="how-ray" d="M224 69l-7-6M284 69l7-6M254 42v-9"/></g></svg>',
  box: '<svg viewBox="0 0 320 176" aria-hidden="true"><g class="how-packet"><rect x="18" y="48" width="55" height="78" rx="9"/><path d="M18 68h55M30 86h30M30 98h21"/><path d="m35 111 20-20"/></g><path class="how-arrow" d="M86 87h31m-10-10 10 10-10 10"/><g class="how-tray"><rect x="129" y="25" width="166" height="126" rx="20"/><path d="M153 49h50v34h-50zM203 49h50v34h-50zM253 49h18v34h-18zM153 83h50v44h-50zM203 83h50v44h-50zM253 83h18v44h-18z"/><circle cx="178" cy="66" r="8"/><path d="m221 58 14 14M216 63l6-6a5 5 0 0 1 7 0l7 7a5 5 0 0 1 0 7l-6 6a5 5 0 0 1-7 0l-7-7a5 5 0 0 1 0-7Z"/><circle cx="178" cy="105" r="8"/><circle cx="228" cy="105" r="8"/></g><g class="how-check"><circle cx="279" cy="32" r="18"/><path d="m270 32 6 6 12-14"/></g></svg>',
};

// ---- Welcome --------------------------------------------------------------

export async function welcomeView({ app }) {
  mount(app, screen({
    body: el('div.welcome', [
      el('div.welcome-head', [
        el('span.welcome-mark', { 'aria-hidden': 'true', text: 'C' }),
        el('h1.welcome-brand', { text: S.appName }),
        el('p.welcome-tagline', { text: S.tagline }),
      ]),

      /* Two 76px stacked buttons and nothing competing with them. The filled
       * one is the person taking the medicines: it is the app's centre of
       * gravity, and it is also the only role that creates an account. */
      el('div.welcome-actions', [
        el('a.role-btn', { href: '#/signin', text: S.roleSimple }),
        el('a.role-btn.role-btn-outline', { href: '#/pair', text: S.roleSupporter }),
        el('a.welcome-how', { href: '#/how', text: S.howItWorks }),
      ]),

      el('p.welcome-foot', { text: S.roleChangeLater }),
    ]),
  }));
}

// ---- How it works ---------------------------------------------------------

/* A route rather than a sheet. It creates no data, so it is safe to open from
 * anywhere -- Welcome, the elder's Settings, the helper's Settings -- and
 * being a route means the phone's own Back button leaves it, which is one less
 * thing to learn. */
export async function howItWorksView({ app, query }) {
  const pages = S.howPages;
  const asked = Number(query?.get('step'));
  let index = Number.isInteger(asked) && asked >= 0 && asked < pages.length ? asked : 0;

  /* Where Back and Close go when the carousel is done with. Passed in by
   * whoever opened it, because "Close" from the elder's Settings must not
   * dump them on the role picker. */
  const exit = query?.get('from') || '#/welcome';

  function draw() {
    const page = pages[index];
    const first = index === 0;
    const last = index === pages.length - 1;

    mount(app, screen({
      head: el('div.how-bar', [
        el('a.back-btn', { href: exit, text: S.howClose }),
        el('span.how-count', { text: S.howCount(index + 1, pages.length) }),
      ]),
      body: el('div.how-body', [
        el('div.how-art', { html: HOW_ART[page.art] || '', 'aria-hidden': 'true' }),
        el('h1.how-title', { text: page.title }),
        el('p.how-text', { text: page.body }),
        el('p.how-note', { text: S.howNote }),
      ]),
      foot: el('div.how-nav', [
        el('button.btn.btn-outline.how-back', {
          type: 'button',
          text: first ? S.howClose : S.howBack,
          onclick: () => { if (first) go(exit); else { index -= 1; draw(); } },
        }),
        el('button.btn.btn-primary.how-next', {
          type: 'button',
          text: last ? S.howDone : S.howNext,
          onclick: () => { if (last) go(exit); else { index += 1; draw(); } },
        }),
      ]),
    }));
  }

  draw();
}
