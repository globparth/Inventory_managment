#!/usr/bin/env node
// Automated setup for Sample Desk.
//
// What this does, using only what's in your .env file:
//   1. Connects to your Supabase Postgres database directly.
//   2. Runs supabase/schema.sql — creates every table, security rule and
//      database function. Safe to run more than once (nothing is duplicated).
//   3. If you also filled in the admin section of .env, creates your first
//      team login and makes it an admin, so the app is ready to sign into
//      immediately with no dashboard clicking at all.
//
// Usage:
//   cp .env.example .env      (then fill it in — see the comments in that file)
//   npm run setup
//
// Nothing here is used by the website itself — it only runs once, on your
// own computer, to prepare the database. It never gets deployed.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m',
}
const ok = (s) => console.log(`${c.green}✓${c.reset} ${s}`)
const info = (s) => console.log(`${c.cyan}→${c.reset} ${s}`)
const warn = (s) => console.log(`${c.yellow}!${c.reset} ${s}`)
const fail = (s) => { console.error(`${c.red}✗ ${s}${c.reset}`); process.exit(1) }
const step = (s) => console.log(`\n${c.bold}${s}${c.reset}`)

// ---- load .env (without overriding anything already set in the shell) ----
function loadEnv(file) {
  if (!fs.existsSync(file)) return
  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnv(path.join(root, '.env'))
loadEnv(path.join(root, '.env.local'))

const DB_URL = process.env.SUPABASE_DB_URL
const SITE_URL = process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ADMIN_EMAIL = process.env.ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
const ADMIN_NAME = process.env.ADMIN_NAME || ''

step('Sample Desk — automated setup')

if (!DB_URL) {
  fail([
    'SUPABASE_DB_URL is not set.',
    '',
    '  1. Copy .env.example to .env if you have not already:  cp .env.example .env',
    '  2. In Supabase: Project Settings → Database → Connection string → URI',
    '     (use "Direct connection"). Paste it as SUPABASE_DB_URL in .env.',
    '  3. Run this again: npm run setup',
  ].join('\n'))
}

const isLocal = /localhost|127\.0\.0\.1|\/var\/run\/postgresql/.test(DB_URL)
const client = new pg.Client({ connectionString: DB_URL, ssl: isLocal ? false : { rejectUnauthorized: false } })

step('1. Connecting to your database')
try {
  await client.connect()
  ok('Connected.')
} catch (e) {
  fail([
    `Could not connect: ${e.message}`,
    '',
    'Check that SUPABASE_DB_URL in .env is exactly what Supabase shows you under',
    'Project Settings → Database → Connection string → URI, with your real',
    'database password in place of [YOUR-PASSWORD].',
  ].join('\n'))
}

step('2. Creating tables, security rules and functions')
const schemaPath = path.join(root, 'supabase', 'schema.sql')
if (!fs.existsSync(schemaPath)) fail(`Could not find ${schemaPath}. Run this from the project folder.`)
const schemaSql = fs.readFileSync(schemaPath, 'utf8')
try {
  await client.query(schemaSql)
  ok('Database is ready.')
} catch (e) {
  await client.end()
  fail(`Something in supabase/schema.sql failed to run: ${e.message}\n\nNo partial changes were rolled back automatically — this script is safe to run again after fixing the issue, since the schema is written to be re-run safely.`)
}

const { rows: tables } = await client.query(
  `select table_name from information_schema.tables where table_schema = 'public' order by 1`,
)
info(`Tables in place: ${tables.map((t) => t.table_name).join(', ')}`)

// ---- optional: create the first admin login ----
step('3. First admin login')
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  warn('ADMIN_EMAIL / ADMIN_PASSWORD not set in .env, so this step is skipped.')
  console.log([
    '',
    'Create your own login by hand instead:',
    '  1. Supabase dashboard → Authentication → Users → Add user',
    '     (tick "Auto confirm user")',
    '  2. Then run this in the SQL Editor:',
    `       update public.profiles set role = 'admin' where email = 'you@company.com';`,
  ].join('\n'))
} else if (!SITE_URL || !SERVICE_KEY) {
  warn('ADMIN_EMAIL / ADMIN_PASSWORD are set, but VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing, so the login cannot be created automatically.')
  console.log([
    '',
    `SUPABASE_SERVICE_ROLE_KEY is in Supabase: Project Settings → API → service_role`,
    '(the SECRET one, not the anon/publishable one — never put this in the website\'s',
    'own environment variables, only here in .env for this one-time setup step).',
    '',
    'Or create the login by hand — see the instructions above.',
  ].join('\n'))
} else {
  try {
    const res = await fetch(`${SITE_URL.replace(/\/+$/, '')}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: ADMIN_EMAIL, password: ADMIN_PASSWORD, email_confirm: true,
        user_metadata: ADMIN_NAME ? { full_name: ADMIN_NAME } : {},
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok) {
      ok(`Created login for ${ADMIN_EMAIL}.`)
    } else if (res.status === 422 || /already been registered|already exists/i.test(body?.msg || body?.message || '')) {
      warn(`${ADMIN_EMAIL} already has a login — leaving it as is.`)
    } else {
      throw new Error(body?.msg || body?.message || `HTTP ${res.status}`)
    }
    await client.query(`update public.profiles set role = 'admin' where email = $1`, [ADMIN_EMAIL])
    ok(`${ADMIN_EMAIL} is an admin.`)
  } catch (e) {
    warn(`Could not create the login automatically: ${e.message}`)
    console.log('Create it by hand instead — see the instructions above.')
  }
}

// ---- optional: create several team logins at once ----
step('4. Team logins')
const TEAM_MEMBERS = (process.env.TEAM_MEMBERS || '').trim()
if (!TEAM_MEMBERS) {
  warn('TEAM_MEMBERS is not set in .env, so this step is skipped — add people by hand in Authentication > Users, or list them in TEAM_MEMBERS and run this again.')
} else if (!SITE_URL || !SERVICE_KEY) {
  warn('TEAM_MEMBERS is set, but VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing, so team logins cannot be created automatically. Add people by hand instead (Authentication > Users > Add user).')
} else {
  const entries = TEAM_MEMBERS.split(',').map((s) => s.trim()).filter(Boolean)
  for (const entry of entries) {
    const [email, password, ...nameParts] = entry.split(':').map((s) => (s || '').trim())
    const name = nameParts.join(':')
    if (!email || !password) { warn(`Skipping "${entry}" — expected email:password or email:password:Name.`); continue }
    try {
      const res = await fetch(`${SITE_URL.replace(/\/+$/, '')}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: name ? { full_name: name } : {} }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) ok(`Created login for ${email}${name ? ` (${name})` : ''}.`)
      else if (res.status === 422 || /already been registered|already exists/i.test(body?.msg || body?.message || '')) warn(`${email} already has a login — leaving it as is.`)
      else throw new Error(body?.msg || body?.message || `HTTP ${res.status}`)
    } catch (e) {
      warn(`Could not create ${email}: ${e.message}`)
    }
  }
}

// ---- turn off public sign-ups reminder (can't be automated: no API for this setting) ----
step('5. One manual step Supabase does not expose an API for')
warn('In Supabase: Authentication → Sign In / Providers → turn OFF "Allow new users to sign up".')
console.log('Without this, anyone could create their own account. This one checkbox has to be clicked by hand.')

await client.end()

step('Done')
console.log([
  '',
  'Your database is ready. Next:',
  '  1. Turn off public sign-ups (step 5 above, in the Supabase dashboard).',
  '  2. Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in .env',
  '     (these are the ones the actual website uses).',
  '  3. npm run dev     — try it locally, or',
  '     npm run build   — then deploy the dist/ folder (see README.md).',
].join('\n'))
