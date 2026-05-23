# iOS 26 Design Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply iOS 26 premium design system across all dashboard pages — fix text sizes, replace pipeline script drawer with a centered spring-animated modal with 4 editable sections (Hook/Body/CTA/Caption), add iOS-spring kanban drag animations, and propagate ambient blobs + card hover springs to every page.

**Architecture:** Each dashboard HTML is self-contained (no shared CSS file beyond settings-panel.css). Changes are per-file CSS/JS edits. Pipeline gets the most surgery (drawer → modal replacement). Other pages get font-scale + animation upgrades only.

**Tech Stack:** Vanilla HTML/CSS/JS, no build step. Static files served via Vercel. LocalStorage for script persistence.

---

## File Map

| File | Changes |
|------|---------|
| `dashboard/pipeline.html` | Remove drawer CSS+HTML+JS; add script modal CSS+HTML+JS; font scale; kanban spring animations; iOS card hover |
| `dashboard/agents.html` | Font scale; iOS card hover spring; ambient blobs already present |
| `dashboard/dashboard.html` | Font scale; iOS card hover spring; ambient blobs already present |
| `dashboard/clients.html` | Font scale; iOS card hover spring; add ambient blobs |
| `dashboard/performance.html` | Font scale; iOS card hover spring; add ambient blobs |
| `dashboard/research.html` | Font scale; iOS card hover spring; add ambient blobs |
| `dashboard/sales-calls.html` | Font scale; iOS card hover spring; add ambient blobs |
| `dashboard/sops.html` | Font scale; iOS card hover spring; add ambient blobs |
| `dashboard/org-chart.html` | Font scale; iOS card hover spring; add ambient blobs |

---

## Task 1: Pipeline — Replace Script Drawer with Centered Modal

**Files:**
- Modify: `dashboard/pipeline.html` (CSS lines 104–131, HTML lines 321–346, JS lines 706–728)

### What to remove
Remove ALL of the following from pipeline.html:
- CSS classes: `.script-drawer`, `.drawer-header`, `.drawer-title`, `.drawer-close`, `.drawer-card-name`, `.drawer-body`, `.drawer-loading`, `.drawer-spinner`, `.drawer-loading-sub`, `.drawer-content`, `.drawer-textarea`, `.drawer-actions`, `.drawer-btn`, `.drawer-btn-save`, `.drawer-btn-discard`, `.drawer-overlay-bg`, `.drawer-tabs`, `.drawer-tab`, `.caption-panel`, `.caption-section-label`, `.caption-box`, `.caption-meta-row`, `.caption-keywords`, `.caption-keyword`, `.caption-hashtags`, `.caption-copy-row`, `.caption-copy-btn`, `.caption-regen-btn`
- HTML: the entire `<!-- DRAWER BACKGROUND OVERLAY -->` div and `<!-- SCRIPT DRAWER -->` div (lines 321–346)
- JS functions: `openDrawer`, `closeDrawer`, `populateDrawer`, `switchDrawerTab`

- [ ] **Step 1: Remove drawer CSS**

In `dashboard/pipeline.html`, find and delete the CSS block starting at `/* SCRIPT DRAWER */` (around line 104) through line 154 (end of `.caption-regen-btn`). This removes all `.script-drawer`, `.drawer-*`, `.caption-*` CSS.

- [ ] **Step 2: Remove drawer HTML**

Delete these two HTML blocks (around lines 321–346):
```html
<!-- DRAWER BACKGROUND OVERLAY -->
<div class="drawer-overlay-bg" id="drawer-overlay-bg" onclick="closeDrawer()"></div>

<!-- SCRIPT DRAWER -->
<div class="script-drawer" id="script-drawer">
  ...all inner content...
</div>
```

- [ ] **Step 3: Remove drawer JS functions**

Delete the `openDrawer`, `closeDrawer`, `populateDrawer`, `switchDrawerTab` functions from the script block.

- [ ] **Step 4: Commit**

```bash
cd /Users/mknevamiss/Claude/Projects/inboundos-site
git add dashboard/pipeline.html
git commit -m "refactor(pipeline): remove old script drawer"
```

---

## Task 2: Pipeline — Add Script Modal CSS

**Files:**
- Modify: `dashboard/pipeline.html` (add new CSS block in `<style>`)

- [ ] **Step 1: Add modal CSS**

Add the following CSS block inside the `<style>` tag in pipeline.html, after the existing `.modal-overlay` / `.modal` block (around line 155):

```css
/* ── SCRIPT MODAL ── */
.script-modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  z-index: 400;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; pointer-events: none;
  transition: opacity 0.25s ease;
}
.script-modal-overlay.open {
  opacity: 1; pointer-events: all;
}
.script-modal-box {
  width: 70vw; height: 85vh;
  background: rgba(12,20,32,0.88);
  backdrop-filter: blur(32px) saturate(160%);
  -webkit-backdrop-filter: blur(32px) saturate(160%);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 20px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.12), 0 32px 80px rgba(0,0,0,0.7);
  display: flex; flex-direction: column;
  transform: scale(0.88) translateY(16px);
  opacity: 0;
  transition: transform 0.4s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s ease;
  overflow: hidden;
}
.script-modal-overlay.open .script-modal-box {
  transform: scale(1) translateY(0);
  opacity: 1;
}
.script-modal-overlay.closing .script-modal-box {
  transform: scale(0.92) translateY(8px);
  opacity: 0;
  transition: transform 0.2s ease-in, opacity 0.2s ease-in;
}
.script-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 24px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  flex-shrink: 0;
}
.script-modal-title {
  font-family: var(--font-head); font-size: 15px; font-weight: 900;
  letter-spacing: -0.5px;
}
.script-modal-title span { color: var(--accent); }
.script-modal-card-name {
  font-family: var(--font-data); font-size: 11px;
  color: var(--text-muted); margin-top: 2px;
}
.script-modal-close {
  background: transparent; border: 1px solid rgba(255,255,255,0.1);
  color: var(--text-muted); font-size: 13px; cursor: pointer;
  padding: 5px 10px; border-radius: 6px;
  transition: all 0.15s; font-family: var(--font-data);
}
.script-modal-close:hover { border-color: rgba(255,255,255,0.25); color: var(--text); }
.script-modal-loading {
  display: none; flex-direction: column; align-items: center;
  justify-content: center; gap: 14px; flex: 1;
  color: var(--accent); font-family: var(--font-data); font-size: 13px;
}
.script-modal-loading.active { display: flex; }
.script-modal-spinner {
  width: 36px; height: 36px;
  border: 2px solid rgba(79,195,247,0.12);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
.script-modal-body {
  flex: 1; overflow-y: auto; padding: 20px 24px;
  display: flex; flex-direction: column; gap: 16px;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.08) transparent;
}
.script-modal-body::-webkit-scrollbar { width: 4px; }
.script-modal-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
.script-section-label {
  font-family: var(--font-head); font-size: 9px; font-weight: 900;
  letter-spacing: 2.5px; text-transform: uppercase;
  color: var(--text-muted); margin-bottom: 6px; display: block;
}
.script-section-label.hook { color: var(--accent); }
.script-section-label.body-lbl { color: var(--green); }
.script-section-label.cta { color: var(--yellow); }
.script-section-label.caption-lbl { color: var(--purple); }
.script-section-ta {
  width: 100%;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px; padding: 14px;
  font-family: var(--font-data); font-size: 14px;
  color: var(--text); line-height: 1.7;
  resize: none; outline: none;
  transition: border-color 0.2s;
}
.script-section-ta:focus { border-color: var(--border-glow); }
.script-section-ta::placeholder { color: var(--text-dim); }
.script-section-ta.hook-ta { min-height: 80px; }
.script-section-ta.body-ta { min-height: 140px; }
.script-section-ta.cta-ta { min-height: 60px; }
.script-section-ta.caption-ta { min-height: 100px; }
.script-modal-footer {
  display: flex; gap: 10px; padding: 14px 24px 18px;
  border-top: 1px solid rgba(255,255,255,0.07); flex-shrink: 0;
}
.script-modal-btn {
  padding: 11px 18px; border-radius: 9px;
  font-family: var(--font-data); font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.18s; letter-spacing: 0.4px;
  border: 1px solid transparent;
}
.script-modal-btn-save {
  flex: 1;
  background: rgba(74,222,128,0.1); border-color: rgba(74,222,128,0.3);
  color: var(--green);
}
.script-modal-btn-save:hover { background: rgba(74,222,128,0.18); }
.script-modal-btn-copy {
  background: rgba(79,195,247,0.08); border-color: rgba(79,195,247,0.2);
  color: var(--accent);
}
.script-modal-btn-copy:hover { background: rgba(79,195,247,0.15); }
.script-modal-btn-discard {
  background: transparent; border-color: rgba(255,255,255,0.08);
  color: var(--text-muted);
}
.script-modal-btn-discard:hover { border-color: var(--red); color: var(--red); }
@media (max-width: 768px) {
  .script-modal-box { width: 96vw; height: 92vh; }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/mknevamiss/Claude/Projects/inboundos-site
git add dashboard/pipeline.html
git commit -m "feat(pipeline): add script modal CSS"
```

---

## Task 3: Pipeline — Add Script Modal HTML

**Files:**
- Modify: `dashboard/pipeline.html` (add HTML before closing `</body>`)

- [ ] **Step 1: Add modal HTML**

Just before `</body>` (after the funnel modal closing `</div>`), add:

```html
<!-- SCRIPT MODAL -->
<div class="script-modal-overlay" id="script-modal-overlay" onclick="onScriptModalOverlayClick(event)">
  <div class="script-modal-box" id="script-modal-box">
    <div class="script-modal-header">
      <div>
        <div class="script-modal-title">Script<span>.</span></div>
        <div class="script-modal-card-name" id="script-modal-card-name">—</div>
      </div>
      <button class="script-modal-close" onclick="closeScriptModal()">✕ Close</button>
    </div>
    <!-- Loading state -->
    <div class="script-modal-loading" id="script-modal-loading">
      <div class="script-modal-spinner"></div>
      <span id="script-modal-loading-text">GENERATING SCRIPT…</span>
      <span style="font-size:11px;color:var(--text-dim);margin-top:2px;" id="script-modal-loading-sub">Quill is writing your reel</span>
    </div>
    <!-- Content -->
    <div class="script-modal-body" id="script-modal-body" style="display:none;">
      <div>
        <span class="script-section-label hook">Hook</span>
        <textarea class="script-section-ta hook-ta" id="smt-hook" placeholder="Opening line that stops the scroll…"></textarea>
      </div>
      <div>
        <span class="script-section-label body-lbl">Body</span>
        <textarea class="script-section-ta body-ta" id="smt-body" placeholder="The value, story, or explanation…"></textarea>
      </div>
      <div>
        <span class="script-section-label cta">CTA</span>
        <textarea class="script-section-ta cta-ta" id="smt-cta" placeholder="What you want them to do next…"></textarea>
      </div>
      <div>
        <span class="script-section-label caption-lbl">Caption</span>
        <textarea class="script-section-ta caption-ta" id="smt-caption" placeholder="Instagram caption + hashtags…"></textarea>
      </div>
    </div>
    <div class="script-modal-footer">
      <button class="script-modal-btn script-modal-btn-save" onclick="saveScriptModal()">✓ Save &amp; Move to Scripting</button>
      <button class="script-modal-btn script-modal-btn-copy" onclick="copyScriptModal()">⎘ Copy All</button>
      <button class="script-modal-btn script-modal-btn-discard" onclick="closeScriptModal()">Discard</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
cd /Users/mknevamiss/Claude/Projects/inboundos-site
git add dashboard/pipeline.html
git commit -m "feat(pipeline): add script modal HTML"
```

---

## Task 4: Pipeline — Add Script Modal JS

**Files:**
- Modify: `dashboard/pipeline.html` (replace openDrawer/closeDrawer/populateDrawer JS with new functions)

The script is stored in localStorage under keys: `ctrl_script_v2_<id>` (hook), `ctrl_script_v2_<id>_body`, `ctrl_script_v2_<id>_cta`, `ctrl_script_v2_<id>_caption`. Legacy key `ctrl_script_v2_<id>` is also checked as a fallback (whole script in one field — split into hook/body/cta if found).

- [ ] **Step 1: Add modal JS functions**

Add the following JS to the `<script>` block, replacing where `openDrawer`/`closeDrawer`/`populateDrawer` were:

```javascript
// ── SCRIPT MODAL ──────────────────────────────────────────────
let scriptModalCard = null;

function scriptModalKeyNs(card) {
  return SCRIPT_NS + (card.dataset.id || card.querySelector('.kcard-title').textContent.trim());
}

function openScriptModal(card, loading = false) {
  scriptModalCard = card;
  const title = card.querySelector('.kcard-title').textContent.trim();
  document.getElementById('script-modal-card-name').textContent = title;

  const loadEl   = document.getElementById('script-modal-loading');
  const bodyEl   = document.getElementById('script-modal-body');
  loadEl.style.display  = loading ? 'flex' : 'none';
  bodyEl.style.display  = loading ? 'none' : 'flex';

  document.getElementById('script-modal-overlay').classList.remove('closing');
  document.getElementById('script-modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeScriptModal() {
  const overlay = document.getElementById('script-modal-overlay');
  overlay.classList.add('closing');
  setTimeout(() => {
    overlay.classList.remove('open', 'closing');
    document.body.style.overflow = '';
    scriptModalCard = null;
  }, 220);
}

function onScriptModalOverlayClick(e) {
  if (e.target === document.getElementById('script-modal-overlay')) closeScriptModal();
}

function populateScriptModal(scriptRaw) {
  // Try to split raw script into Hook / Body / CTA / Caption sections
  // Accept both labelled (HOOK:, BODY:, CTA:, CAPTION:) and plain text
  const hookMatch    = scriptRaw.match(/HOOK[:\s]+([\s\S]*?)(?=\n(?:BODY|CTA|CAPTION)[:\s]|$)/i);
  const bodyMatch    = scriptRaw.match(/BODY[:\s]+([\s\S]*?)(?=\n(?:CTA|CAPTION)[:\s]|$)/i);
  const ctaMatch     = scriptRaw.match(/CTA[:\s]+([\s\S]*?)(?=\n(?:CAPTION)[:\s]|$)/i);
  const captionMatch = scriptRaw.match(/CAPTION[:\s]+([\s\S]*?)$/i);

  document.getElementById('smt-hook').value    = hookMatch    ? hookMatch[1].trim()    : scriptRaw.slice(0, 120).trim();
  document.getElementById('smt-body').value    = bodyMatch    ? bodyMatch[1].trim()    : scriptRaw.slice(120, 600).trim();
  document.getElementById('smt-cta').value     = ctaMatch     ? ctaMatch[1].trim()     : '';
  document.getElementById('smt-caption').value = captionMatch ? captionMatch[1].trim() : '';

  // Also check localStorage for previously split fields
  if (scriptModalCard) {
    const ns = scriptModalKeyNs(scriptModalCard);
    const savedHook    = localStorage.getItem(ns + '_hook');
    const savedBody    = localStorage.getItem(ns + '_body');
    const savedCta     = localStorage.getItem(ns + '_cta');
    const savedCaption = localStorage.getItem(ns + '_caption');
    if (savedHook)    document.getElementById('smt-hook').value    = savedHook;
    if (savedBody)    document.getElementById('smt-body').value    = savedBody;
    if (savedCta)     document.getElementById('smt-cta').value     = savedCta;
    if (savedCaption) document.getElementById('smt-caption').value = savedCaption;
  }

  document.getElementById('script-modal-loading').style.display = 'none';
  document.getElementById('script-modal-body').style.display    = 'flex';
  document.getElementById('smt-hook').focus();
}

function saveScriptModal() {
  if (!scriptModalCard) return;
  const hook    = document.getElementById('smt-hook').value.trim();
  const body    = document.getElementById('smt-body').value.trim();
  const cta     = document.getElementById('smt-cta').value.trim();
  const caption = document.getElementById('smt-caption').value.trim();
  if (!hook && !body) return;

  const ns = scriptModalKeyNs(scriptModalCard);
  const full = [hook && 'HOOK:\n' + hook, body && 'BODY:\n' + body, cta && 'CTA:\n' + cta, caption && 'CAPTION:\n' + caption].filter(Boolean).join('\n\n');

  localStorage.setItem(ns, full);
  localStorage.setItem(ns + '_hook',    hook);
  localStorage.setItem(ns + '_body',    body);
  localStorage.setItem(ns + '_cta',     cta);
  localStorage.setItem(ns + '_caption', caption);

  const _saved = scriptModalCard;
  _saved.classList.add('scripted');
  _saved.onclick = (e) => { if (!e.target.closest('.discard-btn,.caption-btn')) openSavedScriptModal(_saved); };

  const meta = _saved.querySelector('.kcard-meta');
  const oldBtn = meta.querySelector('.script-btn');
  if (oldBtn) oldBtn.remove();
  if (!meta.querySelector('.ktag[data-scripted]')) {
    const badge = document.createElement('span');
    badge.className = 'ktag';
    badge.setAttribute('data-scripted', '1');
    badge.style.cssText = 'background:rgba(74,222,128,0.09);color:var(--green);';
    badge.textContent = '✓ Scripted';
    const discard = meta.querySelector('.discard-btn');
    if (discard) meta.insertBefore(badge, discard);
    else meta.appendChild(badge);
  }

  closeScriptModal();
}

function copyScriptModal() {
  const parts = [
    document.getElementById('smt-hook').value,
    document.getElementById('smt-body').value,
    document.getElementById('smt-cta').value,
    document.getElementById('smt-caption').value,
  ].filter(Boolean);
  navigator.clipboard.writeText(parts.join('\n\n')).catch(() => {});
}

function openSavedScriptModal(card) {
  if (card.classList.contains('dragging')) return;
  openScriptModal(card, false);
  const ns  = scriptModalKeyNs(card);
  const raw = localStorage.getItem(ns) || '';
  populateScriptModal(raw);
}
```

- [ ] **Step 2: Update generateScript to use modal**

Find the `generateScript` function. Replace every call to `openDrawer(card, true)` with `openScriptModal(card, true)`, update loading text refs:

```javascript
// Change:
openDrawer(card, true);
document.getElementById('drawer-loading-text').textContent = 'GENERATING SCRIPT…';
document.getElementById('drawer-loading-sub').textContent = '...';
// To:
openScriptModal(card, true);
document.getElementById('script-modal-loading-text').textContent = 'GENERATING SCRIPT…';
document.getElementById('script-modal-loading-sub').textContent = 'Quill is writing your reel via claude -p';
```

Replace the `populateDrawer(scriptText)` call at the end of the try block with `populateScriptModal(scriptText)`.

Replace the error `populateDrawer(msg)` call with `populateScriptModal(msg)`.

- [ ] **Step 3: Update openSavedScript references**

Find `openSavedScript` function and replace its body with a call to `openSavedScriptModal`:

```javascript
function openSavedScript(card) {
  openSavedScriptModal(card);
}
```

Also update `openCaptionDrawer`:
```javascript
function openCaptionDrawer(card) {
  openSavedScriptModal(card);
}
```

- [ ] **Step 4: Add Escape key handler**

Add to the bottom of the script block:

```javascript
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('script-modal-overlay').classList.contains('open')) {
    closeScriptModal();
  }
});
```

- [ ] **Step 5: Commit**

```bash
cd /Users/mknevamiss/Claude/Projects/inboundos-site
git add dashboard/pipeline.html
git commit -m "feat(pipeline): script modal JS — 4-section Hook/Body/CTA/Caption"
```

---

## Task 5: Pipeline — iOS Spring Kanban Animations + Font Scale

**Files:**
- Modify: `dashboard/pipeline.html`

- [ ] **Step 1: Upgrade kanban card CSS**

Find `.kcard` CSS and replace with:

```css
.kcard {
  background: rgba(255,255,255,0.03);
  border: 1px solid var(--border);
  border-radius: 10px; padding: 11px 12px;
  cursor: grab;
  transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.25s, border-color 0.2s, background 0.2s;
  user-select: none;
}
.kcard:active { cursor: grabbing; }
.kcard:hover {
  border-color: var(--border-glow);
  background: rgba(79,195,247,0.04);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0,0,0,0.35);
}
.kcard.dragging {
  opacity: 0.45;
  transform: scale(1.04) rotate(1.5deg);
  box-shadow: 0 16px 40px rgba(0,0,0,0.55);
  transition: none;
}
```

- [ ] **Step 2: Upgrade kcard-title font size**

Find `.kcard-title` and change `font-size` to `13px`:

```css
.kcard-title { font-family: var(--font-data); font-size: 13px; font-weight: 500; color: var(--text); margin-bottom: 7px; line-height: 1.4; }
```

- [ ] **Step 3: Add drop-zone spring animation**

Find `.col-body.drag-over` and replace:

```css
.col-body.drag-over {
  background: rgba(79,195,247,0.06);
  outline: 1px dashed rgba(79,195,247,0.3);
  outline-offset: -4px;
  transform: scale(1.01);
  transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1), background 0.2s;
  border-radius: 10px;
}
```

- [ ] **Step 4: Add staggered card entrance animation**

Add to CSS:

```css
.kcard { opacity: 0; transform: translateY(8px); }
.kcard.visible { opacity: 1; transform: translateY(0); transition: opacity 0.4s ease, transform 0.4s cubic-bezier(0.34,1.4,0.64,1); }
@media (prefers-reduced-motion: reduce) {
  .kcard { opacity: 1 !important; transform: none !important; transition: none !important; }
}
```

Add to the `DOMContentLoaded` JS (add after cards are rendered into DOM):

```javascript
document.querySelectorAll('.kcard').forEach((card, i) => {
  setTimeout(() => card.classList.add('visible'), 60 + i * 80);
});
```

- [ ] **Step 5: Fix body font size and nav item size**

Find `html,body{` in CSS and ensure `font-size:14px;` (already set — verify).

Find `.nav-item` and change font-size to `13px`.

Find `.kcard-meta` `.ktag` and change font-size to `10px`.

Find `.pipe-stat-lbl` and change font-size to `10px`.

- [ ] **Step 6: Commit**

```bash
cd /Users/mknevamiss/Claude/Projects/inboundos-site
git add dashboard/pipeline.html
git commit -m "feat(pipeline): iOS spring kanban + font scale fixes"
```

---

## Task 6: Global — iOS 26 Design Tokens for All Other Dashboard Pages

Apply to: `agents.html`, `dashboard.html`, `clients.html`, `performance.html`, `research.html`, `sales-calls.html`, `sops.html`, `org-chart.html`

For each file, do the following 4 changes:

**A. Font scale** — find `html,body{` and ensure `font-size:14px`. Find `.nav-item` font-size and set to `13px`. Find `.kcard-title` or `.card` body text and set to `13px`.

**B. Card hover spring** — find `.card:hover` or `.kcard:hover` transition and replace with:
```css
transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.25s, border-color 0.2s;
```
Add `transform: translateY(-2px);` to the hover state.

**C. Ambient blobs** — if not present, add before `</body>`:
```html
<div class="amb amb-1"></div>
<div class="amb amb-2"></div>
<div class="amb amb-3"></div>
```
And add blob CSS if not present:
```css
.amb{position:fixed;border-radius:50%;filter:blur(110px);pointer-events:none;z-index:0;}
.amb-1{width:700px;height:500px;top:-100px;left:10%;background:rgba(79,195,247,0.055);animation:ab1 20s ease-in-out infinite;}
.amb-2{width:500px;height:500px;bottom:5%;right:5%;background:rgba(74,222,128,0.04);animation:ab2 26s ease-in-out infinite;}
.amb-3{width:400px;height:400px;top:40%;left:40%;background:rgba(168,139,250,0.03);animation:ab3 32s ease-in-out infinite;}
@keyframes ab1{0%,100%{transform:translate(0,0) scale(1);}50%{transform:translate(60px,40px) scale(1.08);}}
@keyframes ab2{0%,100%{transform:translate(0,0) scale(1);}50%{transform:translate(-50px,-30px) scale(1.06);}}
@keyframes ab3{0%,100%{transform:translate(0,0) scale(1);}50%{transform:translate(40px,-50px) scale(0.94);}}
@media(prefers-reduced-motion:reduce){.amb{animation:none!important;}}
```

**D. Staggered card entrance** — add to CSS and DOMContentLoaded if `.card` elements are rendered at load:
```css
.card { opacity: 0; transform: translateY(8px); transition: opacity 0.4s ease, transform 0.4s cubic-bezier(0.34,1.4,0.64,1); }
.card.visible { opacity: 1; transform: translateY(0); }
@media (prefers-reduced-motion: reduce) { .card { opacity: 1 !important; transform: none !important; } }
```
```javascript
document.querySelectorAll('.card').forEach((c, i) => {
  setTimeout(() => c.classList.add('visible'), 60 + i * 80);
});
```

- [ ] **Step 1: Apply to agents.html** (ambient blobs already present — skip C; apply A, B, D)

- [ ] **Step 2: Apply to dashboard.html** (ambient blobs already present — skip C; apply A, B, D)

- [ ] **Step 3: Apply to clients.html** (apply A, B, C, D)

- [ ] **Step 4: Apply to performance.html** (apply A, B, C, D)

- [ ] **Step 5: Apply to research.html** (apply A, B, C, D)

- [ ] **Step 6: Apply to sales-calls.html** (apply A, B, C, D)

- [ ] **Step 7: Apply to sops.html** (apply A, B, C, D)

- [ ] **Step 8: Apply to org-chart.html** (apply A, B, C, D)

- [ ] **Step 9: Commit all**

```bash
cd /Users/mknevamiss/Claude/Projects/inboundos-site
git add dashboard/agents.html dashboard/dashboard.html dashboard/clients.html dashboard/performance.html dashboard/research.html dashboard/sales-calls.html dashboard/sops.html dashboard/org-chart.html
git commit -m "feat(dashboard): iOS 26 design tokens — font scale, card springs, ambient blobs on all pages"
```

---

## Task 7: Smoke Test

- [ ] **Step 1: Open pipeline in browser**

```bash
cd /Users/mknevamiss/Claude/Projects/inboundos-site
python3 -m http.server 3333
```
Open http://localhost:3333/dashboard/pipeline.html

- [ ] **Step 2: Verify script modal**
  - Click "✦ Script it" on an idea card → funnel modal appears (existing)
  - After funnel selection → backdrop blurs, centered modal springs in with scale animation
  - 4 sections visible: HOOK, BODY, CTA, CAPTION — all editable, 14px text
  - Click outside modal → exit animation plays (scale down, fade)
  - Press Escape → same exit animation
  - Save → card gets ✓ Scripted badge, modal closes
  - Click scripted card → modal reopens with saved content in correct fields

- [ ] **Step 3: Verify kanban drag**
  - Drag a card → card scales to 1.04 + slight rotation
  - Drag over column → column glows + slight scale
  - Drop → spring release animation on card

- [ ] **Step 4: Verify font sizes**
  - Card titles readable at ~13px
  - Nav items ~13px
  - Stat labels ~10px
  - Modal textareas 14px

- [ ] **Step 5: Verify other pages**
  - Open agents.html → card hover spring present, font readable
  - Open clients.html → ambient blobs visible, card hover spring

- [ ] **Step 6: Push to Vercel**

```bash
cd /Users/mknevamiss/Claude/Projects/inboundos-site
git push origin main
```

---

## Self-Review

**Spec coverage:**
- ✅ Font scale fix (all pages) — Task 5 + Task 6
- ✅ Script modal replace drawer — Tasks 1–4
- ✅ 4 sections Hook/Body/CTA/Caption — Task 3+4
- ✅ 70vw×85vh centered modal — Task 2 CSS
- ✅ Spring enter/exit animation — Task 2 CSS
- ✅ Backdrop blur — Task 2 CSS `.script-modal-overlay`
- ✅ Escape key close — Task 4 Step 4
- ✅ iOS spring kanban drag — Task 5
- ✅ Staggered card entrance — Task 5+6
- ✅ Ambient blobs on all pages — Task 6
- ✅ Card hover spring all pages — Task 6
- ✅ Reduced motion support — Tasks 5+6
- ✅ Smoke test — Task 7

**Placeholder scan:** None found. All code blocks complete.

**Type consistency:** `openScriptModal`/`closeScriptModal`/`populateScriptModal`/`saveScriptModal`/`copyScriptModal`/`openSavedScriptModal` used consistently across Tasks 3+4. `scriptModalKeyNs` used in Task 4. `SCRIPT_NS` referenced from existing codebase constant.
