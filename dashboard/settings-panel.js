// settings-panel.js
(function () {
  const SB_URL = 'https://cscfbuhwlfhblxprkwnh.supabase.co';
  const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzY2ZidWh3bGZoYmx4cHJrd25oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NjMyMjUsImV4cCI6MjA5NTAzOTIyNX0.TNIW7H0iR7WxtPJSJi9LPBmqIiQu8w1xJ2MY4eDYVsA';
  const H = { 'apikey': SB_ANON, 'Authorization': `Bearer ${SB_ANON}`, 'Content-Type': 'application/json' };

  let currentProfile = null;

  function injectModal() {
    const overlay = document.createElement('div');
    overlay.id = 'settings-overlay';
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closePanel();
    });

    const drawer = document.createElement('div');
    drawer.id = 'settings-drawer';
    drawer.innerHTML = `
      <div id="settings-header">
        <span id="settings-title">Edit Profile</span>
        <button id="settings-close" onclick="window.__settingsClose()">&#x2715;</button>
      </div>
      <div id="settings-body"><div class="sp-loading">Loading…</div></div>
    `;

    overlay.appendChild(drawer);
    document.body.appendChild(overlay);
  }

  async function fetchProfile() {
    try {
      const res = await fetch(`${SB_URL}/rest/v1/profiles?select=*&limit=1`, { headers: H });
      if (!res.ok) throw new Error();
      const rows = await res.json();
      return rows[0] || null;
    } catch { return null; }
  }

  async function saveProfile(id, data) {
    await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...H, 'Prefer': 'return=minimal' },
      body: JSON.stringify(data)
    });
  }

  function renderBody(profile) {
    const body = document.getElementById('settings-body');
    const name = profile ? (profile.full_name || 'Micko Cruz') : 'Micko Cruz';
    const role = profile ? (profile.role || profile.company || 'Founder · InboundOS') : 'Founder · InboundOS';
    const avatar = profile ? (profile.avatar_url || 'mk-avatar.jpg') : 'mk-avatar.jpg';

    body.innerHTML = `
      <div class="sp-avatar-wrap">
        <label class="sp-avatar-btn" for="sp-photo-input" title="Change photo">
          <img class="sp-avatar" id="sp-avatar-img" src="${avatar}" alt="Avatar"/>
          <div class="sp-avatar-overlay">
            <span class="sp-avatar-overlay-text">Change<br>Photo</span>
          </div>
        </label>
        <span class="sp-avatar-hint">Click to change photo</span>
        <input type="file" id="sp-photo-input" accept="image/*"/>
      </div>

      <div class="sp-field">
        <div class="sp-field-label">Name</div>
        <input class="sp-input" id="sp-name" type="text" value="${name}" placeholder="Your name"/>
      </div>

      <div class="sp-field">
        <div class="sp-field-label">Role</div>
        <input class="sp-input" id="sp-role" type="text" value="${role}" placeholder="e.g. Founder · InboundOS"/>
      </div>

      <button class="sp-save-btn" id="sp-save-btn" onclick="window.__settingsSave()">Save Changes</button>
      <div class="sp-saved-msg" id="sp-saved-msg">Changes saved</div>
    `;

    // Photo preview
    document.getElementById('sp-photo-input').addEventListener('change', function() {
      const file = this.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(e) {
        document.getElementById('sp-avatar-img').src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  window.__settingsSave = async function() {
    const btn = document.getElementById('sp-save-btn');
    const msg = document.getElementById('sp-saved-msg');
    const name = document.getElementById('sp-name').value.trim();
    const role = document.getElementById('sp-role').value.trim();

    btn.disabled = true;
    btn.textContent = 'Saving…';

    // Update sidebar immediately
    const nameEl = document.querySelector('.mk-name');
    const roleEl = document.querySelector('.mk-role');
    if (nameEl) nameEl.textContent = name;
    if (roleEl) roleEl.textContent = role;

    // Save to Supabase if profile exists
    if (currentProfile) {
      await saveProfile(currentProfile.id, { full_name: name, role: role });
    }

    // Handle photo upload (base64 store in profile if no storage bucket)
    const photoInput = document.getElementById('sp-photo-input');
    if (photoInput.files[0] && currentProfile) {
      const reader = new FileReader();
      reader.onload = async function(e) {
        const avatarEl = document.querySelector('.mk-avatar-wrap img');
        if (avatarEl) avatarEl.src = e.target.result;
        // Store data URL in profile (small images only)
        await saveProfile(currentProfile.id, { avatar_url: e.target.result });
      };
      reader.readAsDataURL(photoInput.files[0]);
    }

    btn.disabled = false;
    btn.textContent = 'Save Changes';
    msg.classList.add('show');
    setTimeout(() => msg.classList.remove('show'), 2500);
  };

  async function openPanel() {
    document.getElementById('settings-overlay').classList.add('open');
    document.getElementById('settings-drawer').classList.add('open');
    document.getElementById('settings-body').innerHTML = '<div class="sp-loading">Loading…</div>';
    currentProfile = await fetchProfile();
    renderBody(currentProfile);
  }

  function closePanel() {
    document.getElementById('settings-overlay').classList.remove('open');
    document.getElementById('settings-drawer').classList.remove('open');
  }

  window.__settingsOpen = openPanel;
  window.__settingsClose = closePanel;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectModal);
  } else {
    injectModal();
  }
})();
