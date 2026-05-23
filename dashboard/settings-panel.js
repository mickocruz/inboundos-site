// settings-panel.js
(function () {
  const SB_URL = 'https://cscfbuhwlfhblxprkwnh.supabase.co';
  const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzY2ZidWh3bGZoYmx4cHJrd25oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NjMyMjUsImV4cCI6MjA5NTAzOTIyNX0.TNIW7H0iR7WxtPJSJi9LPBmqIiQu8w1xJ2MY4eDYVsA';
  const SB_HEADERS = {
    'apikey': SB_ANON,
    'Authorization': `Bearer ${SB_ANON}`,
    'Content-Type': 'application/json'
  };

  function injectDrawer() {
    const overlay = document.createElement('div');
    overlay.id = 'settings-overlay';
    overlay.addEventListener('click', closePanel);

    const drawer = document.createElement('div');
    drawer.id = 'settings-drawer';
    drawer.innerHTML = `
      <div id="settings-header">
        <span id="settings-title">Settings</span>
        <button id="settings-close" onclick="window.__settingsClose()">&#x2715;</button>
      </div>
      <div id="settings-body"><div class="sp-loading">Loading…</div></div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
  }

  async function fetchProfile() {
    try {
      const res = await fetch(
        `${SB_URL}/rest/v1/profiles?select=*&limit=1`,
        { headers: SB_HEADERS }
      );
      if (!res.ok) throw new Error('fetch failed');
      const rows = await res.json();
      return rows[0] || null;
    } catch {
      return null;
    }
  }

  async function savePref(id, field, value) {
    await fetch(
      `${SB_URL}/rest/v1/profiles?id=eq.${id}`,
      {
        method: 'PATCH',
        headers: { ...SB_HEADERS, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ [field]: value })
      }
    );
  }

  function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function statusDot(status) {
    const cls = status === 'active' ? 'active' : status === 'onboarding' ? 'onboarding' : 'inactive';
    return `<span class="sp-status-dot ${cls}"></span>`;
  }

  function renderBody(profile) {
    const body = document.getElementById('settings-body');
    if (!profile) {
      body.innerHTML = `
        <div class="sp-section">
          <div class="sp-section-label">Profile</div>
          <div class="sp-avatar-row">
            <img class="sp-avatar" src="mk-avatar.jpg" alt="Avatar"/>
            <div>
              <div class="sp-avatar-name">Micko Cruz</div>
              <div class="sp-avatar-company">InboundOS</div>
            </div>
          </div>
        </div>
        <div class="sp-section">
          <div class="sp-section-label">Account</div>
          <div class="sp-field">
            <div class="sp-field-label">Plan</div>
            <div class="sp-field-value"><span class="sp-badge">DWY Coaching</span></div>
          </div>
        </div>
      `;
      return;
    }

    const notifChecked = profile.notify_email ? 'checked' : '';
    const tz = profile.timezone || 'America/New_York';
    const timezones = [
      'America/New_York','America/Chicago','America/Denver',
      'America/Los_Angeles','America/Anchorage','Pacific/Honolulu',
      'Europe/London','Europe/Paris','Asia/Tokyo','Australia/Sydney'
    ];
    const tzOptions = timezones.map(t =>
      `<option value="${t}" ${t === tz ? 'selected' : ''}>${t.replace('_',' ')}</option>`
    ).join('');

    body.innerHTML = `
      <div class="sp-section">
        <div class="sp-section-label">Profile</div>
        <div class="sp-avatar-row">
          <img class="sp-avatar" src="${profile.avatar_url || 'mk-avatar.jpg'}" alt="Avatar"/>
          <div>
            <div class="sp-avatar-name">${profile.full_name || '—'}</div>
            <div class="sp-avatar-company">${profile.company || '—'}</div>
          </div>
        </div>
        <div class="sp-field">
          <div class="sp-field-label">Email</div>
          <div class="sp-field-value">${profile.email || '—'}</div>
        </div>
      </div>

      <div class="sp-section">
        <div class="sp-section-label">Account</div>
        <div class="sp-field">
          <div class="sp-field-label">Plan</div>
          <div class="sp-field-value"><span class="sp-badge">${profile.plan || 'DWY Coaching'}</span></div>
        </div>
        <div class="sp-field">
          <div class="sp-field-label">Member Since</div>
          <div class="sp-field-value">${formatDate(profile.start_date || profile.created_at)}</div>
        </div>
        <div class="sp-field">
          <div class="sp-field-label">Status</div>
          <div class="sp-field-value">${statusDot(profile.status)}${profile.status ? profile.status.charAt(0).toUpperCase() + profile.status.slice(1) : 'Active'}</div>
        </div>
        <div class="sp-field">
          <div class="sp-field-label">Onboarding</div>
          <div class="sp-field-value">${profile.onboarding_status || 'Complete'}</div>
        </div>
      </div>

      <div class="sp-section">
        <div class="sp-section-label">Preferences</div>
        <div class="sp-toggle-row">
          <span class="sp-toggle-label">Email notifications</span>
          <label class="sp-toggle">
            <input type="checkbox" id="sp-notify" ${notifChecked}/>
            <div class="sp-toggle-track"></div>
            <div class="sp-toggle-thumb"></div>
          </label>
        </div>
        <div class="sp-field">
          <div class="sp-field-label">Timezone</div>
          <select class="sp-select" id="sp-tz">${tzOptions}</select>
        </div>
      </div>
    `;

    document.getElementById('sp-notify').addEventListener('change', function () {
      savePref(profile.id, 'notify_email', this.checked);
    });
    document.getElementById('sp-tz').addEventListener('change', function () {
      savePref(profile.id, 'timezone', this.value);
    });
  }

  async function openPanel() {
    document.getElementById('settings-overlay').classList.add('open');
    document.getElementById('settings-drawer').classList.add('open');
    document.getElementById('settings-body').innerHTML = '<div class="sp-loading">Loading…</div>';
    const profile = await fetchProfile();
    renderBody(profile);
  }

  function closePanel() {
    document.getElementById('settings-overlay').classList.remove('open');
    document.getElementById('settings-drawer').classList.remove('open');
  }

  window.__settingsOpen = openPanel;
  window.__settingsClose = closePanel;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectDrawer);
  } else {
    injectDrawer();
  }
})();
