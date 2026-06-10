const SUPABASE_URL = 'https://cscfbuhwlfhblxprkwnh.supabase.co';
const SUPABASE_ANON = 'sb_publishable_1ZqIVolUXpUocXTtHP3yBA_UFNidOD8';

const SCORE_BADGE = {
  hot:  { bg: '#3d1010', color: '#f85149', label: 'HOT' },
  warm: { bg: '#2d2400', color: '#e3b341', label: 'WARM' },
  cold: { bg: '#1c1c1c', color: '#8899a6', label: 'COLD' }
};

const STATUS_OPTIONS = ['new', 'contacted', 'booked', 'lost'];

async function loadInboundLeads() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/inbound_leads?order=created_at.desc`, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: 'Bearer ' + SUPABASE_ANON
    }
  });
  if (!res.ok) return; // logged out or RLS denied — leave section empty
  const leads = await res.json();
  if (!Array.isArray(leads)) return;
  renderInboundLeads(leads);
}

function renderInboundLeads(leads) {
  const container = document.getElementById('inbound-leads-section');
  if (!container) return;

  container.innerHTML = `
    <h2 style="font-family:'NHG Display',sans-serif;font-size:24px;font-weight:900;letter-spacing:-0.02em;margin-bottom:20px;">Inbound Leads</h2>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.08);text-align:left;">
            <th style="padding:10px 12px;color:#8899a6;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;font-size:11px;">Date</th>
            <th style="padding:10px 12px;color:#8899a6;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;font-size:11px;">Name</th>
            <th style="padding:10px 12px;color:#8899a6;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;font-size:11px;">IG</th>
            <th style="padding:10px 12px;color:#8899a6;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;font-size:11px;">Revenue</th>
            <th style="padding:10px 12px;color:#8899a6;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;font-size:11px;">Problem</th>
            <th style="padding:10px 12px;color:#8899a6;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;font-size:11px;">Score</th>
            <th style="padding:10px 12px;color:#8899a6;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;font-size:11px;">Status</th>
          </tr>
        </thead>
        <tbody id="inbound-leads-tbody">
          ${leads.map(lead => renderLeadRow(lead)).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderLeadRow(lead) {
  const date = lead.created_at ? new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
  const score = (lead.qualify_score || 'cold').toLowerCase();
  const badge = SCORE_BADGE[score] || SCORE_BADGE.cold;
  const statusOpts = STATUS_OPTIONS.map(s =>
    `<option value="${s}" ${lead.status === s ? 'selected' : ''}>${s}</option>`
  ).join('');

  return `
    <tr style="border-bottom:1px solid rgba(255,255,255,0.05);" data-id="${lead.id}">
      <td style="padding:12px;color:#8899a6;">${date}</td>
      <td style="padding:12px;color:#fff;font-weight:500;">${esc(lead.name || '—')}<br><span style="font-size:11px;color:#8899a6;">${esc(lead.email || '')}</span></td>
      <td style="padding:12px;color:#4fc3f7;">${lead.instagram_handle ? esc(lead.instagram_handle) : '—'}</td>
      <td style="padding:12px;color:#fff;">${esc(lead.monthly_revenue || '—')}</td>
      <td style="padding:12px;color:#8899a6;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(lead.biggest_problem || '')}">${esc(lead.biggest_problem || '—')}</td>
      <td style="padding:12px;">
        <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:0.08em;background:${badge.bg};color:${badge.color};">
          ${badge.label}
        </span>
        ${lead.qualify_reason ? `<br><span style="font-size:11px;color:#8899a6;">${esc(lead.qualify_reason)}</span>` : ''}
      </td>
      <td style="padding:12px;">
        <select onchange="updateLeadStatus('${lead.id}', this.value)"
          style="background:#1c2c3b;border:1px solid rgba(255,255,255,0.08);color:#fff;font-family:inherit;font-size:12px;padding:6px 10px;border-radius:8px;cursor:pointer;outline:none;">
          ${statusOpts}
        </select>
      </td>
    </tr>
  `;
}

async function updateLeadStatus(id, status) {
  await fetch(`${SUPABASE_URL}/rest/v1/inbound_leads?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: 'Bearer ' + SUPABASE_ANON,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({ status })
  });
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

loadInboundLeads();
