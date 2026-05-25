// settings-panel.js
(function () {
  const SB_URL = 'https://cscfbuhwlfhblxprkwnh.supabase.co';
  const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzY2ZidWh3bGZoYmx4cHJrd25oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NjMyMjUsImV4cCI6MjA5NTAzOTIyNX0.TNIW7H0iR7WxtPJSJi9LPBmqIiQu8w1xJ2MY4eDYVsA';
  const H = { 'apikey': SB_ANON, 'Authorization': `Bearer ${SB_ANON}`, 'Content-Type': 'application/json' };

  const SB_SVC = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzY2ZidWh3bGZoYmx4cHJrd25oIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTQ2MzIyNSwiZXhwIjoyMDk1MDM5MjI1fQ.8ik968LXAthPkd6nkKOOOFlzTbR-94A22l5T_9T17GE';

  async function uploadAvatar(file) {
    const ext = file.name.split('.').pop();
    const path = `avatar.${ext}`;
    const res = await fetch(`${SB_URL}/storage/v1/object/avatars/${path}`, {
      method: 'POST',
      headers: { 'apikey': SB_SVC, 'Authorization': `Bearer ${SB_SVC}`, 'x-upsert': 'true' },
      body: file
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error('Upload failed: ' + err);
    }
    return `${SB_URL}/storage/v1/object/public/avatars/${path}?t=${Date.now()}`;
  }

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
      const res = await fetch(`${SB_URL}/rest/v1/ctrl_users?select=id,username,full_name,role,avatar_url&limit=1`, { headers: H });
      if (!res.ok) throw new Error();
      const rows = await res.json();
      return rows[0] || null;
    } catch { return null; }
  }

  async function saveProfile(id, data) {
    await fetch(`${SB_URL}/rest/v1/ctrl_users?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...H, 'Prefer': 'return=minimal' },
      body: JSON.stringify(data)
    });
  }

  function renderBody(profile) {
    const body = document.getElementById('settings-body');
    const name = profile ? (profile.full_name || 'Micko Cruz') : 'Micko Cruz';
    const role = profile ? (profile.role || 'Founder · InboundOS') : 'Founder · InboundOS';
    const avatar = profile ? (profile.avatar_url || '/micko.jpg') : '/micko.jpg';

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

    try {
      const profileData = { full_name: name, role: role };

      // Upload photo first if selected
      const photoInput = document.getElementById('sp-photo-input');
      if (photoInput.files[0]) {
        const publicUrl = await uploadAvatar(photoInput.files[0]);
        profileData.avatar_url = publicUrl;
        // Update all avatar images on page
        document.querySelectorAll('.mk-avatar-wrap img, #sp-avatar-img').forEach(el => el.src = publicUrl);
      }

      // Save name + role (+ avatar_url if uploaded) in one call
      if (currentProfile) {
        await saveProfile(currentProfile.id, profileData);
      }

      // Update sidebar text
      const nameEl = document.querySelector('.mk-name');
      const roleEl = document.querySelector('.mk-role');
      if (nameEl) nameEl.textContent = name;
      if (roleEl) roleEl.textContent = role;

      msg.classList.add('show');
      setTimeout(() => msg.classList.remove('show'), 2500);
    } catch (err) {
      alert('Save failed: ' + err.message);
    }

    btn.disabled = false;
    btn.textContent = 'Save Changes';
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

  async function initSidebar() {
    const profile = await fetchProfile();
    if (!profile) return;
    const nameEl = document.querySelector('.mk-name');
    const roleEl = document.querySelector('.mk-role');
    const avatarEl = document.querySelector('.mk-avatar-wrap img');
    if (nameEl && profile.full_name) nameEl.textContent = profile.full_name;
    if (roleEl && profile.role) roleEl.textContent = profile.role;
    if (avatarEl && profile.avatar_url) avatarEl.src = profile.avatar_url;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { injectModal(); initSidebar(); });
  } else {
    injectModal();
    initSidebar();
  }
})();
