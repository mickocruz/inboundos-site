#!/usr/bin/env python3
"""
InboundOS Client Provisioner
=============================
Run this after a client completes their onboarding form.

Usage:
    python3 provision-client.py --email client@email.com --username john-smith --password their-password --sb-url https://xxx.supabase.co --sb-anon eyJ... --sb-service eyJ...

What it does:
    1. Pulls their onboarding form answers from Supabase
    2. Maps answers → client_config fields
    3. Inserts client into your master clients table
    4. Inserts client_config into THEIR Supabase
    5. Generates pre-filled workflow JSON files ready to hand to client
"""

import argparse, json, re, os, sys, glob
import urllib.request, urllib.error

# ── YOUR MASTER SUPABASE ──────────────────────────────────────
MASTER_URL = 'https://cscfbuhwlfhblxprkwnh.supabase.co'
MASTER_SVC = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzY2ZidWh3bGZoYmx4cHJrd25oIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTQ2MzIyNSwiZXhwIjoyMDk1MDM5MjI1fQ.8ik968LXAthPkd6nkKOOOFlzTbR-94A22l5T_9T17GE'

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
WORKFLOWS_DIR = os.path.join(SCRIPT_DIR, '..', 'workflows')
OUTPUT_DIR    = os.path.join(SCRIPT_DIR, '..', 'client-workflows')


def req(url, method='GET', data=None, headers={}):
    body = json.dumps(data).encode() if data else None
    r = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        print(f'HTTP {e.code}: {e.read().decode()}')
        sys.exit(1)


def master_headers(content=False):
    h = {'apikey': MASTER_SVC, 'Authorization': f'Bearer {MASTER_SVC}'}
    if content: h['Content-Type'] = 'application/json'
    return h


def their_headers(svc, content=False):
    h = {'apikey': svc, 'Authorization': f'Bearer {svc}'}
    if content: h['Content-Type'] = 'application/json'
    return h


def parse_voice(brand_voice):
    """Extract tone, words, avoid from brand_voice string."""
    if not brand_voice:
        return '', '', ''
    bv = str(brand_voice)
    tone  = bv[:120] if len(bv) > 120 else bv
    words = ''
    avoid = ''
    # Try to extract if structured
    if 'avoid' in bv.lower():
        parts = re.split(r'avoid|don.t use', bv, flags=re.IGNORECASE)
        avoid = parts[1].strip()[:120] if len(parts) > 1 else ''
    return tone, words, avoid


def parse_icp(icp):
    """Extract ICP fields from icp string."""
    if not icp:
        return '', '', '', ''
    s = str(icp)
    return s[:120], '', '', ''


def main():
    parser = argparse.ArgumentParser(description='Provision an InboundOS client')
    parser.add_argument('--email',      required=True,  help='Client email (matches onboarding table)')
    parser.add_argument('--username',   required=True,  help='Login username slug e.g. john-smith')
    parser.add_argument('--password',   required=True,  help='Login password to set')
    parser.add_argument('--sb-url',     required=True,  help='Client Supabase Project URL')
    parser.add_argument('--sb-anon',    required=True,  help='Client Supabase anon key')
    parser.add_argument('--sb-service', required=True,  help='Client Supabase service_role key')
    args = parser.parse_args()

    client_slug = args.username.lower().replace(' ', '-')
    client_id   = client_slug.replace('-', '_')

    print(f'\n🔍 Fetching onboarding data for {args.email}...')
    rows = req(
        f"{MASTER_URL}/rest/v1/onboarding?email=eq.{args.email}&limit=1",
        headers=master_headers()
    )
    if not rows:
        print(f'No onboarding record found for {args.email}')
        sys.exit(1)

    ob = rows[0]
    print(f'✓ Found onboarding record')

    # ── Parse name from email or client_profile ──
    profile     = ob.get('client_profile') or {}
    if isinstance(profile, str):
        try: profile = json.loads(profile)
        except: profile = {}
    first_name  = profile.get('first_name') or args.email.split('@')[0].split('.')[0].capitalize()
    last_name   = profile.get('last_name', '')
    agency_name = profile.get('agency_name', '')

    # ── Map onboarding fields → client_config ──
    icp_raw = ob.get('icp', '')
    tone, words, avoid = parse_voice(ob.get('brand_voice', ''))
    icp_title, icp_pain, icp_result, icp_revenue = parse_icp(icp_raw)

    # Pull competitors list
    competitors = ob.get('competitors', '')
    if isinstance(competitors, list): competitors = ', '.join(competitors)

    config = {
        'client_id':    client_id,
        'first_name':   first_name,
        'last_name':    last_name,
        'agency_name':  agency_name,
        'niche':        str(ob.get('differentiator', ''))[:200],
        'icp_title':    icp_title,
        'icp_pain':     str(ob.get('objections', ''))[:200],
        'icp_result':   str(ob.get('delivery_process', ''))[:200],
        'icp_revenue':  icp_revenue,
        'voice_tone':   tone,
        'voice_words':  str(ob.get('hooks', ''))[:200],
        'voice_avoid':  avoid,
        'voice_pillars':str(ob.get('origin_story', ''))[:200],
        'post_frequency': 'daily',
        'platform':     'instagram',
        'n8n_webhook':  '',
    }

    # ── Step 1: Hash password ──
    print('\n🔑 Hashing password...')
    pw_hash = req(
        f"{MASTER_URL}/rest/v1/rpc/hash_password",
        method='POST',
        data={'input_password': args.password},
        headers={**master_headers(content=True), 'Prefer': 'return=minimal'}
    )
    print('✓ Password hashed')

    # ── Step 2: Insert into master clients table ──
    print('\n👤 Creating client login...')
    req(
        f"{MASTER_URL}/rest/v1/clients",
        method='POST',
        data={
            'username':                client_slug,
            'password_hash':           pw_hash,
            'client_id':               client_id,
            'client_slug':             client_slug,
            'client_supabase_url':     args.sb_url,
            'client_supabase_anon':    args.sb_anon,
            'client_supabase_service': args.sb_service,
        },
        headers={**master_headers(content=True), 'Prefer': 'return=minimal'}
    )
    print(f'✓ Client login created: {client_slug}')

    # ── Step 3: Insert client_config into THEIR Supabase ──
    print('\n📋 Writing config to their Supabase...')
    req(
        f"{args.sb_url}/rest/v1/client_config",
        method='POST',
        data=config,
        headers={**their_headers(args.sb_service, content=True), 'Prefer': 'return=minimal'}
    )
    print('✓ client_config populated from onboarding form')

    # ── Step 4: Generate pre-filled workflow files ──
    print('\n📦 Generating pre-filled workflow files...')
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    client_out = os.path.join(OUTPUT_DIR, client_slug)
    os.makedirs(client_out, exist_ok=True)

    replacements = {
        '{{SUPABASE_URL}}':       args.sb_url,
        '{{SUPABASE_ANON_KEY}}':  args.sb_anon,
        '{{SUPABASE_SERVICE_KEY}}': args.sb_service,
        '{{SUPABASE_KEY}}':       args.sb_service,
        '{{CLIENT_ID}}':          client_id,
        '{{CLIENT_SLUG}}':        client_slug,
        '{{CLIENT_FIRST_NAME}}':  first_name,
        '{{GROQ_API_KEY}}':       '-- ADD YOUR GROQ KEY HERE --',
    }

    templates = glob.glob(os.path.join(WORKFLOWS_DIR, '*-TEMPLATE.json'))
    for t in templates:
        raw = open(t).read()
        for find, replace in replacements.items():
            raw = raw.replace(find, replace)
        out_name = os.path.basename(t).replace('-TEMPLATE', '')
        out_path = os.path.join(client_out, out_name)
        open(out_path, 'w').write(raw)

    print(f'✓ {len(templates)} workflow files written to: client-workflows/{client_slug}/')

    print(f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ CLIENT PROVISIONED: {first_name} {last_name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dashboard URL : https://inboundos.vercel.app/login
Username      : {client_slug}
Password      : {args.password}

Workflow files: client-workflows/{client_slug}/

Send client:
  1. Their login credentials above
  2. The folder: client-workflows/{client_slug}/
  3. Tell them to import each .json into n8n
  4. They only need to add their API keys (Claude, Instagram)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
""")


if __name__ == '__main__':
    main()
