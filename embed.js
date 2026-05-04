/*!
 * tarmacq Verify — embeddable widget
 *
 * Usage (auto-render):
 *   <div data-tq-verify data-sitekey="YOUR_SITE_KEY"
 *        data-callback="onVerified"
 *        data-error-callback="onVerifyError"></div>
 *   <script src="https://verify.tarmacq.com/embed.js" async defer></script>
 *
 * Usage (manual):
 *   const id = TarmacqVerify.render(element, {
 *       sitekey: 'YOUR_SITE_KEY',
 *       callback: (token) => { ... },
 *       errorCallback: (err) => { ... },
 *       theme: 'light'   // 'light' | 'dark'
 *   });
 *   TarmacqVerify.getResponse(id);  // -> token | null
 *   TarmacqVerify.reset(id);
 *
 * Configuration via script tag:
 *   <script src=".../embed.js" data-api="https://verify-api.tarmacq.com"></script>
 *
 * The script injects a hidden input named "tq-verify-token" into the parent
 * <form> on success, so server-side handlers can read it like any form field.
 */
(function (global) {
  'use strict';

  // ---- Config ----
  const SCRIPT = document.currentScript || (function () {
    const s = document.getElementsByTagName('script');
    return s[s.length - 1];
  })();
  const API_BASE = (SCRIPT && SCRIPT.dataset.api) || 'https://verify-api.tarmacq.com';
  const LOGO_URL = (SCRIPT && SCRIPT.dataset.logo) || 'https://cd.tarmacq.com/tarmacq/img/tarmacq new logo no bg black.png';

  // ---- State ----
  const widgets = new Map();
  let nextId = 1;

  // ---- Font (declared in document head once, CORS required at the font origin) ----
  const FONT_URL = (SCRIPT && SCRIPT.dataset.fontUrl) || 'https://cd.tarmacq.com/fonts/NeuePower-Ultra.ttf';
  (function injectFontOnce() {
    if (document.getElementById('tq-verify-fontface')) return;
    const s = document.createElement('style');
    s.id = 'tq-verify-fontface';
    s.textContent = `@font-face{font-family:'NeuePower';src:url('${FONT_URL}') format('truetype');font-weight:900;font-style:normal;font-display:swap;}`;
    document.head.appendChild(s);
    // Preload hint for faster first paint
    const link = document.createElement('link');
    link.rel = 'preload'; link.as = 'font'; link.type = 'font/ttf'; link.crossOrigin = 'anonymous'; link.href = FONT_URL;
    document.head.appendChild(link);
  })();

  // ---- Styles (shadow-DOM scoped) ----
  const STYLES = `
    :host { all: initial; display: inline-block; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
    *, *::before, *::after { box-sizing: border-box; }
    .root {
      position: relative;
      width: 320px;
      background: #FFFFFF;
      border: 1px solid #E7E5E4;
      border-radius: 12px;
      box-shadow: 0 1px 0 rgba(0,0,0,0.02), 0 4px 14px -8px rgba(0,0,0,0.08);
      overflow: hidden;
      transition: box-shadow .25s ease, border-color .25s ease, transform .15s ease;
      color: #0A0A0A;
      letter-spacing: -0.01em;
    }
    .root::before {
      content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: #0A0A0A;
      transition: background .2s ease;
    }
    .root::after {
      content: ''; position: absolute; inset: 0; pointer-events: none;
      background-image: repeating-linear-gradient(135deg, rgba(0,0,0,0.018) 0 1px, transparent 1px 8px);
      mix-blend-mode: multiply;
      opacity: .9;
    }
    .root:hover { border-color: #D6D3D1; box-shadow: 0 1px 0 rgba(0,0,0,0.02), 0 8px 22px -10px rgba(0,0,0,0.12); }
    .root.is-verified::before { background: #16A34A; }
    .root.is-failed::before { background: #DC2626; }
    .root.is-loading::before, .root.is-challenge::before { background: linear-gradient(180deg, #0A0A0A 0%, #0A0A0A 50%, #6B6B6B 50%, #6B6B6B 100%); background-size: 100% 200%; animation: stripeRun 1.4s linear infinite; }
    @keyframes stripeRun { from { background-position: 0 0; } to { background-position: 0 -100%; } }
    .row {
      position: relative;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 14px 0 18px;
      height: 76px;
      z-index: 1;
    }
    .left {
      width: 28px; height: 28px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      cursor: pointer;
      user-select: none;
    }
    .label {
      flex: 1;
      font-family: 'NeuePower', 'Inter', system-ui, sans-serif;
      font-size: 17px;
      font-weight: 900;
      line-height: 1.05;
      letter-spacing: 0;
      cursor: pointer;
      user-select: none;
    }
    .label .sub {
      display: block;
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 11px;
      font-weight: 500;
      color: #6B6B6B;
      margin-top: 4px;
      letter-spacing: 0;
    }
    .label .sub.error {
      font-family: 'NeuePower', 'Inter', system-ui, sans-serif;
      font-size: 13px;
      font-weight: 900;
      color: #DC2626;
    }
    .right {
      display: flex; flex-direction: column; align-items: flex-end; gap: 4px;
      flex-shrink: 0;
    }
    .right img {
      height: 50px; width: auto; display: block; opacity: 1;
    }
    .right .meta {
      font-size: 10px; font-weight: 500; color: #6B6B6B; letter-spacing: 0.02em;
    }
    .right .meta a { color: inherit; text-decoration: none; }
    .right .meta a:hover { text-decoration: underline; }

    /* Idle box */
    .box {
      width: 22px; height: 22px;
      border: 1.5px solid #0A0A0A;
      border-radius: 3px;
      background: #fff;
      transition: background .15s ease, border-color .15s ease;
    }
    .left:hover .box { background: #F5F5F4; }

    /* Spinner — tarmacq chevron arc */
    .spinner {
      width: 26px; height: 26px;
      animation: spin 1.1s cubic-bezier(.6,.2,.4,.8) infinite;
    }
    .spinner svg { width: 100%; height: 100%; }
    .spinner .arc {
      fill: none; stroke: #0A0A0A; stroke-width: 2.5;
      stroke-linecap: square; stroke-dasharray: 50 100; stroke-dashoffset: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Check — clean, weighted */
    .check {
      width: 28px; height: 28px;
      stroke: #16A34A;
      stroke-width: 3.2;
      fill: none;
      stroke-linecap: square;
      stroke-linejoin: miter;
    }
    .check path {
      stroke-dasharray: 30;
      stroke-dashoffset: 30;
      animation: draw .42s cubic-bezier(.65,.05,.36,1) forwards;
    }
    @keyframes draw { to { stroke-dashoffset: 0; } }

    /* X */
    .x {
      width: 26px; height: 26px;
      stroke: #DC2626;
      stroke-width: 3;
      stroke-linecap: square;
      fill: none;
    }
    .x path {
      stroke-dasharray: 30;
      stroke-dashoffset: 30;
      animation: draw .3s cubic-bezier(.65,.05,.36,1) forwards;
    }

    /* Challenge */
    .challenge {
      padding: 14px;
      border-top: 1px solid #E7E5E4;
      background: #FAFAF9;
      display: none;
    }
    .root.is-challenge .challenge { display: block; }
    .root.is-challenge { box-shadow: 0 8px 24px rgba(0,0,0,0.08); }

    .ch-title {
      font-size: 12px;
      font-weight: 600;
      color: #0A0A0A;
      margin: 0 0 4px;
    }
    .ch-sub {
      font-size: 11px;
      color: #6B6B6B;
      margin: 0 0 14px;
    }
    /* Press / registration challenge */
    .press {
      position: relative;
      width: 100%;
      height: 156px;
      background: #fff;
      border: 1px solid #E7E5E4;
      border-radius: 6px;
      overflow: hidden;
      background-image:
        repeating-linear-gradient(0deg, rgba(0,0,0,0.012) 0 1px, transparent 1px 9px),
        repeating-linear-gradient(90deg, rgba(0,0,0,0.012) 0 1px, transparent 1px 9px);
    }
    .crop { position: absolute; width: 9px; height: 9px; pointer-events: none; }
    .crop.tl { top: 6px; left: 6px;   border-top: 1px solid #0A0A0A; border-left: 1px solid #0A0A0A; }
    .crop.tr { top: 6px; right: 6px;  border-top: 1px solid #0A0A0A; border-right: 1px solid #0A0A0A; }
    .crop.bl { bottom: 6px; left: 6px;  border-bottom: 1px solid #0A0A0A; border-left: 1px solid #0A0A0A; }
    .crop.br { bottom: 6px; right: 6px; border-bottom: 1px solid #0A0A0A; border-right: 1px solid #0A0A0A; }
    .press-tag {
      position: absolute; top: 8px; left: 22px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 9px; letter-spacing: 0.16em; color: #A8A8A8; text-transform: uppercase;
    }
    .slot {
      position: absolute;
      left: 50%; top: 28px;
      transform: translateX(-50%);
      width: 64px; height: 64px;
      border: 1.5px dashed #C2C0BD;
      border-radius: 2px;
      pointer-events: none;
    }
    .slot::before, .slot::after {
      content: '';
      position: absolute; left: 50%; transform: translateX(-50%);
      width: 1px; height: 6px; background: #6B6B6B;
    }
    .slot::before { top: -10px; }
    .slot::after  { bottom: -10px; }
    .guide {
      position: absolute;
      left: 50%; top: 0; bottom: 0;
      width: 1px;
      background: repeating-linear-gradient(to bottom, rgba(0,0,0,0.18) 0 2px, transparent 2px 5px);
      transform: translateX(-50%);
      pointer-events: none;
    }
    .piece {
      position: absolute;
      bottom: 16px;
      width: 64px; height: 64px;
      cursor: grab;
      touch-action: none;
      user-select: none;
      transition: transform .05s linear, filter .15s ease;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.18));
    }
    .piece.grabbing { cursor: grabbing; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.25)); }
    .piece svg { width: 100%; height: 100%; display: block; }
    .press.is-aligned .slot { border-color: #16A34A; }
    .press.is-aligned .piece { filter: drop-shadow(0 2px 6px rgba(22,163,74,0.35)); }
    .press-meta {
      display: flex; justify-content: space-between; align-items: center;
      margin-top: 8px; margin-bottom: 12px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 9px; letter-spacing: 0.12em; color: #A8A8A8; text-transform: uppercase;
    }
    .press-meta .ok { color: #16A34A; }
    .ch-actions {
      display: flex; gap: 8px;
    }
    .btn {
      flex: 1;
      height: 36px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      border: 1px solid transparent;
      transition: background .12s ease, border-color .12s ease, transform .08s ease;
    }
    .btn:active { transform: translateY(1px); }
    .btn.primary { background: #0A0A0A; color: #fff; }
    .btn.primary:hover { background: #1F1F1F; }
    .btn.primary:disabled { background: #E7E5E4; color: #A8A8A8; cursor: not-allowed; }
    .btn.ghost { background: #fff; color: #0A0A0A; border-color: #E7E5E4; }
    .btn.ghost:hover { background: #F5F5F4; }

    /* Dark theme */
    .root.theme-dark { background: #0F0F10; border-color: #2A2A2A; color: #FAFAF9; box-shadow: 0 1px 2px rgba(0,0,0,0.4); }
    .root.theme-dark .box { border-color: #FAFAF9; background: #0F0F10; }
    .root.theme-dark .spinner { border-color: #FAFAF9; border-top-color: transparent; }
    .root.theme-dark .left:hover .box { background: #1F1F1F; }
    .root.theme-dark .right .meta { color: #A8A8A8; }
    .root.theme-dark .right img { filter: invert(1); }
    .root.theme-dark .challenge { background: #161618; border-top-color: #2A2A2A; }
    .root.theme-dark .ch-title { color: #FAFAF9; }
    .root.theme-dark .ch-sub { color: #A8A8A8; }
    .root.theme-dark .dial-wrap { background: #0F0F10; border-color: #2A2A2A; }
    .root.theme-dark .btn.primary { background: #FAFAF9; color: #0A0A0A; }
    .root.theme-dark .btn.primary:hover { background: #FFFFFF; }
    .root.theme-dark .btn.ghost { background: #0F0F10; color: #FAFAF9; border-color: #2A2A2A; }
  `;

  // ---- HTML templates ----
  function tplCheckboxIdle() {
    return `<div class="box" aria-hidden="true"></div>`;
  }
  function tplSpinner() {
    return `<div class="spinner" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <circle class="arc" cx="12" cy="12" r="10"/>
      </svg>
    </div>`;
  }
  function tplCheck() {
    return `<svg class="check" viewBox="0 0 24 24"><path d="M3 12.5l6 6L21 5"/></svg>`;
  }
  function tplX() {
    return `<svg class="x" viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19"/></svg>`;
  }

  function buildShell(theme) {
    const wrap = document.createElement('div');
    wrap.className = `root theme-${theme || 'light'}`;
    wrap.innerHTML = `
      <div class="row">
        <div class="left" data-role="cell">${tplCheckboxIdle()}</div>
        <div class="label" data-role="label">
          im not a robot
          <span class="sub" data-role="sub" hidden></span>
        </div>
        <div class="right">
          <img src="${LOGO_URL}" alt="tarmacq" />
          <div class="meta">
            <a href="https://www.tarmacq.com/pp" target="_blank" rel="noopener">privacy</a>
            ·
            <a href="https://www.tarmacq.com/terms" target="_blank" rel="noopener">terms</a>
          </div>
        </div>
      </div>
      <div class="challenge" data-role="challenge">
        <p class="ch-title">Print check</p>
        <p class="ch-sub">Slide the mark into the slot above.</p>
        <div class="press" data-role="press">
          <span class="press-tag">CH·01 / Registration</span>
          <span class="crop tl"></span><span class="crop tr"></span>
          <span class="crop bl"></span><span class="crop br"></span>
          <div class="guide"></div>
          <div class="slot" data-role="slot"></div>
          <div class="piece" data-role="piece">
            <svg viewBox="0 0 64 64" aria-hidden="true">
              <path d="M14 8 L50 8 L50 28 L36 28 L56 56 L40 56 L24 32 L24 56 L14 56 Z" fill="#0A0A0A"/>
            </svg>
          </div>
        </div>
        <div class="press-meta">
          <span data-role="offset">offset · —</span>
          <span data-role="hint">drag to align</span>
        </div>
        <div class="ch-actions">
          <button class="btn ghost" data-role="ch-cancel" type="button">Reset</button>
          <button class="btn primary" data-role="ch-submit" type="button">Confirm</button>
        </div>
      </div>
    `;
    return wrap;
  }

  // ---- Behavioral signals ----
  function makeTracker() {
    const t0 = performance.now();
    let mouseDist = 0, lastX = null, lastY = null, moves = 0, keys = 0;
    const onMove = (e) => {
      moves++;
      if (lastX !== null) {
        mouseDist += Math.hypot(e.clientX - lastX, e.clientY - lastY);
      }
      lastX = e.clientX; lastY = e.clientY;
    };
    const onKey = () => keys++;
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('keydown', onKey, { passive: true });
    return {
      snapshot() {
        return {
          ttf: Math.round(performance.now() - t0),  // time to first interaction
          mouseDist: Math.round(mouseDist),
          mouseMoves: moves,
          keyCount: keys,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
          lang: navigator.language || '',
          screen: `${screen.width}x${screen.height}`,
          ua: navigator.userAgent.slice(0, 200)
        };
      },
      destroy() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('keydown', onKey);
      }
    };
  }

  // ---- Proof of work (sha256) ----
  async function solveChallenge(challenge, difficulty) {
    // difficulty = number of leading zero hex chars required
    const enc = new TextEncoder();
    const prefix = '0'.repeat(difficulty);
    let nonce = 0;
    const t0 = performance.now();
    while (true) {
      const data = enc.encode(challenge + ':' + nonce);
      const hashBuf = await crypto.subtle.digest('SHA-256', data);
      const hex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
      if (hex.startsWith(prefix)) {
        return { nonce, ms: Math.round(performance.now() - t0) };
      }
      nonce++;
      // Yield to event loop occasionally so the UI doesn't freeze
      if ((nonce & 0xFFF) === 0) await new Promise(r => setTimeout(r, 0));
    }
  }

  // ---- API helpers ----
  async function apiChallenge(sitekey) {
    const r = await fetch(`${API_BASE}/v1/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sitekey })
    });
    if (!r.ok) throw new Error(`challenge ${r.status}`);
    return r.json();  // { challenge, difficulty, ttl }
  }
  async function apiVerify(payload) {
    const r = await fetch(`${API_BASE}/v1/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error(`verify ${r.status}`);
    return r.json();  // { ok, token?, requireChallenge?, reason? }
  }

  // ---- Widget core ----
  class Widget {
    constructor(host, opts) {
      this.id = nextId++;
      this.host = host;
      this.opts = opts;
      this.token = null;
      this.tracker = makeTracker();
      this.state = 'idle';

      // Shadow DOM for style isolation
      this.shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : null;
      const root = this.shadow || host;
      const style = document.createElement('style');
      style.textContent = STYLES;
      root.appendChild(style);

      this.shell = buildShell(opts.theme);
      root.appendChild(this.shell);

      this.cell = this.shell.querySelector('[data-role="cell"]');
      this.label = this.shell.querySelector('[data-role="label"]');
      this.sub = this.shell.querySelector('[data-role="sub"]');
      this.challenge = this.shell.querySelector('[data-role="challenge"]');
      this.press = this.shell.querySelector('[data-role="press"]');
      this.slot = this.shell.querySelector('[data-role="slot"]');
      this.piece = this.shell.querySelector('[data-role="piece"]');
      this.offsetLabel = this.shell.querySelector('[data-role="offset"]');
      this.hintLabel = this.shell.querySelector('[data-role="hint"]');
      this.pieceOffsetPx = 0;
      this.resetPiece();

      this.cell.addEventListener('click', () => this.onCellClick());
      this.label.addEventListener('click', () => this.onCellClick());
      this.shell.querySelector('[data-role="ch-cancel"]').addEventListener('click', () => this.resetPiece());
      this.shell.querySelector('[data-role="ch-submit"]').addEventListener('click', () => this.submitChallenge());
      this.bindPiece();

      widgets.set(this.id, this);
    }

    setLeft(html) {
      this.cell.innerHTML = html;
    }
    setSub(text, error) {
      if (!text) { this.sub.hidden = true; this.sub.textContent = ''; return; }
      this.sub.hidden = false;
      this.sub.textContent = text;
      this.sub.classList.toggle('error', !!error);
    }
    setLabel(main) {
      // Preserve sub element
      const sub = this.sub.cloneNode(true);
      this.label.textContent = main;
      this.label.appendChild(sub);
      this.sub = sub;
    }

    async onCellClick() {
      if (this.state === 'loading' || this.state === 'verified' || this.state === 'challenge') return;
      this.toLoading();
      try {
        const ch = await apiChallenge(this.opts.sitekey);
        const start = performance.now();
        const pow = await solveChallenge(ch.challenge, ch.difficulty || 4);
        // Ensure spinner shows for at least 900ms for perceived effort
        const elapsed = performance.now() - start;
        if (elapsed < 900) await new Promise(r => setTimeout(r, 900 - elapsed));

        const res = await apiVerify({
          sitekey: this.opts.sitekey,
          challenge: ch.challenge,
          nonce: pow.nonce,
          signals: this.tracker.snapshot()
        });
        if (res.ok && res.token) return this.toVerified(res.token);
        if (res.requireChallenge) return this.toChallenge(ch.challenge, res.challengeNonce);
        return this.toFailed(res.reason || 'failed');
      } catch (err) {
        console.error('[tq-verify]', err);
        this.toFailed('network');
      }
    }

    setRootState(name) {
      ['is-loading', 'is-verified', 'is-failed', 'is-challenge'].forEach(c => this.shell.classList.remove(c));
      if (name) this.shell.classList.add(name);
    }
    toLoading() {
      this.state = 'loading';
      this.setLeft(tplSpinner());
      this.setSub('verifying…');
      this.setRootState('is-loading');
    }
    toVerified(token) {
      this.state = 'verified';
      this.token = token;
      this.setLeft(tplCheck());
      this.setSub('');
      this.setRootState('is-verified');
      // Inject hidden form input if inside a form
      const form = this.host.closest('form');
      if (form) {
        let input = form.querySelector('input[name="tq-verify-token"]');
        if (!input) {
          input = document.createElement('input');
          input.type = 'hidden';
          input.name = 'tq-verify-token';
          form.appendChild(input);
        }
        input.value = token;
      }
      this.host.dispatchEvent(new CustomEvent('tq-verify:success', { detail: { token } }));
      this._invoke(this.opts.callback, token);
      this._invokeGlobal(this.host.getAttribute('data-callback'), token);
    }
    toFailed(reason) {
      this.state = 'failed';
      this.token = null;
      this.setLeft(tplX());
      this.setSub('failed to verify', true);
      this.setRootState('is-failed');
      this.host.dispatchEvent(new CustomEvent('tq-verify:error', { detail: { reason } }));
      this._invoke(this.opts.errorCallback, reason);
      this._invokeGlobal(this.host.getAttribute('data-error-callback'), reason);
      // Auto-reset after 4s so user can retry
      setTimeout(() => { if (this.state === 'failed') this.reset(); }, 4000);
    }
    toChallenge(baseChallenge, challengeNonce) {
      this.state = 'challenge';
      this._challengeBase = baseChallenge;
      this._challengeNonce = challengeNonce;
      this.setLeft(tplSpinner());
      this.setSub('one quick check');
      this.resetPiece();
      this.setRootState('is-challenge');
    }
    async submitChallenge() {
      const offsetPx = Math.round(this.pieceOffsetPx);
      this.toLoading();
      try {
        const res = await apiVerify({
          sitekey: this.opts.sitekey,
          challenge: this._challengeBase,
          nonce: this._challengeNonce,
          challengeAnswer: { offsetPx, off: Math.abs(offsetPx) },
          signals: this.tracker.snapshot()
        });
        if (res.ok && res.token) return this.toVerified(res.token);
        return this.toFailed(res.reason || 'wrong');
      } catch (err) {
        this.toFailed('network');
      }
    }

    resetPiece() {
      // Random initial offset between ±40 and ±90 px from center
      const dir = Math.random() < 0.5 ? -1 : 1;
      this.pieceOffsetPx = dir * randInt(42, 92);
      this.applyPiecePosition();
    }
    applyPiecePosition() {
      if (!this.piece) return;
      const half = this.piece.offsetWidth / 2;
      // Position is from container center; piece left = 50% + offset - halfWidth
      this.piece.style.left = `calc(50% + ${this.pieceOffsetPx}px - ${half}px)`;
      const ok = Math.abs(this.pieceOffsetPx) <= 8;
      if (this.press) this.press.classList.toggle('is-aligned', ok);
      if (this.offsetLabel) this.offsetLabel.textContent = `offset · ${this.pieceOffsetPx >= 0 ? '+' : ''}${Math.round(this.pieceOffsetPx)}px`;
      if (this.hintLabel) this.hintLabel.innerHTML = ok ? '<span class="ok">aligned</span>' : 'drag to align';
    }
    bindPiece() {
      const piece = this.piece;
      let dragging = false;
      let startClientX = 0, startOffset = 0;
      const xOf = (e) => (e.touches ? e.touches[0].clientX : e.clientX);
      const start = (e) => {
        if (this.state !== 'challenge') return;
        e.preventDefault();
        startClientX = xOf(e);
        startOffset = this.pieceOffsetPx;
        dragging = true;
        piece.classList.add('grabbing');
      };
      const move = (e) => {
        if (!dragging) return;
        e.preventDefault();
        const dx = xOf(e) - startClientX;
        const wrapWidth = this.press.clientWidth;
        const pieceWidth = piece.offsetWidth;
        const max = (wrapWidth - pieceWidth) / 2 - 6;
        let next = startOffset + dx;
        if (next > max) next = max;
        if (next < -max) next = -max;
        this.pieceOffsetPx = next;
        this.applyPiecePosition();
      };
      const end = () => {
        if (!dragging) return;
        dragging = false;
        piece.classList.remove('grabbing');
      };
      piece.addEventListener('mousedown', start);
      piece.addEventListener('touchstart', start, { passive: false });
      window.addEventListener('mousemove', move);
      window.addEventListener('touchmove', move, { passive: false });
      window.addEventListener('mouseup', end);
      window.addEventListener('touchend', end);
    }

    reset() {
      this.state = 'idle';
      this.token = null;
      this.setLeft(tplCheckboxIdle());
      this.setSub('');
      this.setRootState(null);
      const form = this.host.closest('form');
      if (form) {
        const input = form.querySelector('input[name="tq-verify-token"]');
        if (input) input.value = '';
      }
    }

    _invoke(fn, arg) {
      try { if (typeof fn === 'function') fn(arg); } catch (e) { console.error('[tq-verify] callback error', e); }
    }
    _invokeGlobal(name, arg) {
      if (!name) return;
      const fn = global[name];
      if (typeof fn === 'function') this._invoke(fn, arg);
    }
  }

  function randInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  // ---- Public API ----
  const TarmacqVerify = {
    render(element, opts = {}) {
      if (typeof element === 'string') element = document.querySelector(element);
      if (!element) throw new Error('[tq-verify] target element not found');
      if (element.dataset.tqVerifyMounted === '1') return Number(element.dataset.tqVerifyId);
      const sitekey = opts.sitekey || element.getAttribute('data-sitekey');
      if (!sitekey) throw new Error('[tq-verify] sitekey is required');
      const w = new Widget(element, {
        sitekey,
        theme: opts.theme || element.getAttribute('data-theme') || 'light',
        callback: opts.callback,
        errorCallback: opts.errorCallback
      });
      element.dataset.tqVerifyMounted = '1';
      element.dataset.tqVerifyId = String(w.id);
      return w.id;
    },
    getResponse(id) {
      const w = widgets.get(id);
      return w ? w.token : null;
    },
    reset(id) {
      const w = widgets.get(id);
      if (w) w.reset();
    }
  };

  global.TarmacqVerify = TarmacqVerify;

  // Auto-render on DOMContentLoaded
  function autoRender() {
    document.querySelectorAll('[data-tq-verify]').forEach((el) => {
      try { TarmacqVerify.render(el); } catch (e) { console.error(e); }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoRender);
  } else {
    autoRender();
  }

})(window);
