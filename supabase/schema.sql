-- =====================================================================
--  GIPL Sample Desk  -  database schema for Supabase (Postgres)
--  Run this whole file once in:  Supabase Dashboard > SQL Editor > New query
--  It is safe to run again: everything uses "create or replace" / "if not exists".
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Team members (linked to Supabase Auth users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'team' check (role in ('team', 'admin', 'disabled')),
  created_at  timestamptz not null default now()
);

-- Every user you create in Auth > Users automatically becomes a 'team' member.
-- (Keep "Allow new users to sign up" switched OFF, so only people you add can log in.)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Pick up any users that already exist
insert into public.profiles (id, email, full_name)
select id, email, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

create or replace function public.is_team()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role in ('team', 'admin'));
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'admin');
$$;

-- ---------------------------------------------------------------------
-- 2. Products (one row per QR code)
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  seq             bigint generated always as identity,      -- print / assignment order
  code            text not null unique,                     -- the short code inside the QR
  batch           text,                                     -- which print run it came from
  name            text,
  category        text,
  description     text,
  total_samples   int  not null default 0 check (total_samples >= 0),
  samples_given   int  not null default 0 check (samples_given >= 0),
  next_sample_no  int  not null default 1,                  -- numbers are never reused
  status          text not null default 'unassigned' check (status in ('unassigned', 'active')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint given_within_total check (samples_given <= total_samples)
);
create index if not exists products_status_idx on public.products (status, seq);

-- ---------------------------------------------------------------------
-- 2b. Product catalog (a name/category/description list, imported from
--     CSV, with NO code attached). Used only to fill in the "pick a
--     product" dropdown when a blank QR code is scanned/assigned -- it
--     never creates or consumes a code by itself.
-- ---------------------------------------------------------------------
create table if not exists public.product_catalog (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  category     text,
  description  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists product_catalog_name_idx on public.product_catalog (lower(name));

-- ---------------------------------------------------------------------
-- 3. Sample log (one row per sample handed out)
-- ---------------------------------------------------------------------
create table if not exists public.sample_log (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references public.products(id) on delete restrict,
  sample_no       int  not null,
  recipient_name  text not null,
  phone           text,
  phone_key       text,                                     -- last 10 digits, for matching repeat visitors
  email           text,
  company         text,
  notes           text,
  given_by        uuid references auth.users(id) on delete set null,
  given_by_name   text,
  given_at        timestamptz not null default now(),
  client_id       uuid unique,                              -- makes offline retries safe (no double entries)
  voided          boolean not null default false,
  voided_at       timestamptz,
  void_reason     text,
  unique (product_id, sample_no)
);
create index if not exists sample_log_product_idx on public.sample_log (product_id);
create index if not exists sample_log_time_idx    on public.sample_log (given_at desc);
create index if not exists sample_log_phone_idx   on public.sample_log (phone_key);

-- ---------------------------------------------------------------------
-- 4. Security: nobody touches tables directly except admins reading.
--    Everything else goes through the functions below.
-- ---------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.products       enable row level security;
alter table public.product_catalog enable row level security;
alter table public.sample_log     enable row level security;

revoke all on public.profiles, public.products, public.product_catalog, public.sample_log from anon, authenticated;
grant select on public.profiles, public.products, public.product_catalog, public.sample_log to authenticated;

drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

drop policy if exists "products: admin read" on public.products;
create policy "products: admin read" on public.products
  for select to authenticated using (public.is_admin());

drop policy if exists "product_catalog: admin read" on public.product_catalog;
create policy "product_catalog: admin read" on public.product_catalog
  for select to authenticated using (public.is_admin());

drop policy if exists "sample_log: admin read" on public.sample_log;
create policy "sample_log: admin read" on public.sample_log
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- 5. Functions
-- ---------------------------------------------------------------------

-- 5a. What a scan shows. Public gets product info only. Team also gets counts.
--     Every code is one sample unit, so the stock shown here is the whole
--     product's -- every active code sharing this product's name, not just
--     this one label -- and "code_given" says whether THIS specific label
--     has already been handed out (it can only ever give once).
create or replace function public.scan_product(p_code text)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  p         public.products%rowtype;
  res       jsonb;
  team      boolean := public.is_team();
  agg_total int := 0;
  agg_given int := 0;
begin
  select * into p from public.products where code = upper(trim(p_code));
  if not found then
    return json_build_object('found', false);
  end if;

  res := jsonb_build_object(
    'found', true, 'code', p.code, 'status', p.status,
    'name', p.name, 'category', p.category, 'description', p.description,
    'team', team
  );

  if team then
    if p.name is not null then
      select count(*), count(*) filter (where samples_given > 0)
        into agg_total, agg_given
        from public.products
       where status = 'active' and name = p.name;
    end if;

    res := res || jsonb_build_object(
      'total', agg_total,
      'given', agg_given,
      'left',  agg_total - agg_given,
      'next_no', agg_given + 1,
      'code_given', p.samples_given > 0,
      'recent', coalesce((
        select jsonb_agg(x) from (
          select l.sample_no, l.recipient_name, l.given_by_name, l.given_at
          from public.sample_log l
          join public.products pp on pp.id = l.product_id
          where pp.name = p.name and pp.status = 'active' and not l.voided
          order by l.given_at desc limit 5
        ) x), '[]'::jsonb)
    );
  end if;

  return res::json;
end $$;

-- 5b. Give one sample. Locks the specific scanned code so two people
--     scanning it at the same moment can never both give from it -- but the
--     "left"/"sample_no" reported back are for the whole product (every
--     active code sharing this name), since that is the stock that matters.
create or replace function public.give_sample(
  p_code text, p_name text, p_phone text, p_email text, p_company text,
  p_notes text, p_client_id uuid, p_given_at timestamptz default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  p         public.products%rowtype;
  dup       public.sample_log%rowtype;
  n         int;
  who       text;
  digits    text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  agg_total int;
  agg_given int;
begin
  if not public.is_team() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  if coalesce(trim(p_name), '') = '' then
    return json_build_object('ok', false, 'error', 'Name is required');
  end if;
  if digits = '' and coalesce(trim(p_email), '') = '' then
    return json_build_object('ok', false, 'error', 'Add a phone number or an email');
  end if;

  select * into p from public.products where code = upper(trim(p_code)) for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Unknown product code');
  end if;

  -- already saved (retry after a bad connection)? report success, do nothing.
  select * into dup from public.sample_log where client_id = p_client_id;
  if found then
    select count(*), count(*) filter (where samples_given > 0) into agg_total, agg_given
      from public.products where status = 'active' and name = p.name;
    return json_build_object('ok', true, 'duplicate', true, 'product', p.name,
      'sample_no', dup.sample_no, 'left', agg_total - agg_given);
  end if;

  if p.status <> 'active' then
    return json_build_object('ok', false, 'error', 'This product has not been set up yet');
  end if;
  if p.samples_given >= p.total_samples then
    return json_build_object('ok', false, 'error', 'This label has already been given out. Scan a different label for this product.');
  end if;

  n := p.next_sample_no;
  select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = auth.uid();

  update public.products
     set samples_given = samples_given + 1, next_sample_no = n + 1, updated_at = now()
   where id = p.id;

  insert into public.sample_log (product_id, sample_no, recipient_name, phone, phone_key, email,
                                 company, notes, given_by, given_by_name, given_at, client_id)
  values (p.id, n, trim(p_name), nullif(trim(coalesce(p_phone, '')), ''),
          case when length(digits) >= 7 then right(digits, 10) end,
          nullif(lower(trim(coalesce(p_email, ''))), ''),
          nullif(trim(coalesce(p_company, '')), ''), nullif(trim(coalesce(p_notes, '')), ''),
          auth.uid(), who, least(coalesce(p_given_at, now()), now()), p_client_id);

  select count(*), count(*) filter (where samples_given > 0) into agg_total, agg_given
    from public.products where status = 'active' and name = p.name;

  return json_build_object('ok', true, 'product', p.name, 'sample_no', agg_given,
                           'left', agg_total - agg_given);
end $$;

-- 5c. Set up / edit a product. Team can fill in a blank code; only admins can edit a live one.
create or replace function public.save_product(
  p_code text, p_name text, p_category text, p_description text, p_total int
) returns json language plpgsql security definer set search_path = public as $$
declare
  p public.products%rowtype;
begin
  if not public.is_team() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    return json_build_object('ok', false, 'error', 'Product name is required');
  end if;
  if p_total is null or p_total < 0 then
    return json_build_object('ok', false, 'error', 'Sample count must be 0 or more');
  end if;

  select * into p from public.products where code = upper(trim(p_code)) for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Unknown product code');
  end if;
  if p.status = 'active' and not public.is_admin() then
    raise exception 'Only an admin can edit a product that is already set up' using errcode = '42501';
  end if;
  if p_total < p.samples_given then
    return json_build_object('ok', false,
      'error', format('%s samples are already given, so the total cannot be lower', p.samples_given));
  end if;

  update public.products
     set name = trim(p_name),
         category = nullif(trim(coalesce(p_category, '')), ''),
         description = nullif(trim(coalesce(p_description, '')), ''),
         total_samples = p_total, status = 'active', updated_at = now()
   where id = p.id;

  return json_build_object('ok', true, 'code', p.code);
end $$;

-- 5d. Small list of every active product, cached on the phone for offline use
--     and used to build the "existing product" dropdown when claiming a blank code.
create or replace function public.get_catalog()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_team() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return coalesce((select json_agg(json_build_array(code, name, category, description) order by name)
                   from public.products where status = 'active'), '[]'::json);
end $$;

-- 5e. Autofill for repeat visitors (matches on the last 10 digits of the phone number).
create or replace function public.find_recipient(p_phone text)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  d text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  r record;
begin
  if not public.is_team() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if length(d) < 7 then return json_build_object('found', false); end if;

  select recipient_name, email, company into r
  from public.sample_log
  where phone_key = right(d, 10) and not voided
  order by given_at desc limit 1;

  if not found then return json_build_object('found', false); end if;
  return json_build_object('found', true, 'name', r.recipient_name,
                           'email', r.email, 'company', r.company);
end $$;

-- 5f. The last 10 samples the current user handed out.
create or replace function public.my_recent()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_team() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return coalesce((
    select json_agg(x) from (
      select l.sample_no, l.recipient_name, l.given_at, p.name as product, p.code
      from public.sample_log l join public.products p on p.id = l.product_id
      where l.given_by = auth.uid() and not l.voided
      order by l.given_at desc limit 10
    ) x), '[]'::json);
end $$;

-- 5g. Admin: cancel a wrong entry. The sample goes back into stock; its number is not reused.
create or replace function public.void_sample(p_log_id uuid, p_reason text default null)
returns json language plpgsql security definer set search_path = public as $$
declare l public.sample_log%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select * into l from public.sample_log where id = p_log_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Entry not found');
  end if;
  if l.voided then
    return json_build_object('ok', true);
  end if;
  update public.products
     set samples_given = greatest(samples_given - 1, 0), updated_at = now()
   where id = l.product_id;
  update public.sample_log
     set voided = true, voided_at = now(), void_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = l.id;
  return json_build_object('ok', true);
end $$;

-- 5h. Admin: create blank QR codes (random, unguessable, no confusing characters).
create or replace function public.gen_code()
returns text language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';   -- no 0 O 1 I L
  b bytea := gen_random_bytes(6);
  r text := '';
  i int;
begin
  for i in 0..5 loop
    r := r || substr(alphabet, (get_byte(b, i) % 31) + 1, 1);
  end loop;
  return r;
end $$;

create or replace function public.generate_codes(p_count int, p_batch text default null)
returns text[] language plpgsql security definer set search_path = public, extensions as $$
declare
  c   text;
  out text[] := '{}';
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if p_count is null or p_count < 1 or p_count > 5000 then
    raise exception 'Choose between 1 and 5000 codes' using errcode = '22023';
  end if;
  while coalesce(array_length(out, 1), 0) < p_count loop
    c := public.gen_code();
    insert into public.products (code, batch) values (c, nullif(trim(coalesce(p_batch, '')), ''))
      on conflict (code) do nothing;
    if found then out := out || c; end if;
  end loop;
  return out;
end $$;

-- 5i. Admin: bulk import a product CATALOG from CSV rows (name / category /
--     description only). This never touches QR codes -- it only fills in
--     the "pick a product" dropdown shown when someone scans a blank code.
--     Importing the same name again just updates its category/description.
create or replace function public.import_product_catalog(p_rows jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  r    jsonb;
  i    int := 0;
  nm   text;
  ok_n int := 0;
  errs jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    nm := nullif(trim(r->>'name'), '');
    if nm is null then
      errs := errs || jsonb_build_object('row', i, 'error', 'Missing product name');
      continue;
    end if;

    insert into public.product_catalog (name, category, description)
    values (nm, nullif(trim(coalesce(r->>'category', '')), ''),
            nullif(trim(coalesce(r->>'description', '')), ''))
    on conflict (lower(name)) do update
      set category = excluded.category,
          description = excluded.description,
          updated_at = now();

    ok_n := ok_n + 1;
  end loop;

  return json_build_object('imported', ok_n, 'errors', errs);
end $$;

-- 5i-2. List of products to pick from when assigning a blank code: the
--       imported catalog, plus any product already in use on a printed
--       code (in case it was set up by hand and never added to the catalog).
--       "assigned" / "given" count active codes carrying that name -- each
--       code is exactly one sample unit, so "assigned" IS the stock count.
create or replace function public.get_product_picker()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_team() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return coalesce((
    select json_agg(json_build_object(
             'name', t.name, 'category', t.category, 'description', t.description,
             'assigned', coalesce(c.assigned, 0), 'given', coalesce(c.given, 0)
           ) order by t.name)
    from (
      select distinct on (lower(x.name)) x.name, x.category, x.description
      from (
        select name, category, description, 0 as pri from public.product_catalog
        union all
        select name, category, description, 1 as pri from public.products
         where status = 'active' and name is not null
      ) x
      order by lower(x.name), x.pri
    ) t
    left join (
      select name, count(*) as assigned, count(*) filter (where samples_given > 0) as given
      from public.products
      where status = 'active' and name is not null
      group by name
    ) c on c.name = t.name
  ), '[]'::json);
end $$;

-- 5j. Admin: numbers for the dashboard.
create or replace function public.admin_stats()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return json_build_object(
    'codes_total',   (select count(*) from public.products),
    'assigned',      (select count(*) from public.products where status = 'active'),
    'unassigned',    (select count(*) from public.products where status = 'unassigned'),
    'samples_total', (select coalesce(sum(total_samples), 0) from public.products),
    'samples_given', (select coalesce(sum(samples_given), 0) from public.products),
    'people',        (select count(distinct coalesce(phone_key, email)) from public.sample_log where not voided),
    'last_24h',      (select count(*) from public.sample_log where not voided and given_at > now() - interval '24 hours'),
    'out_of_stock',  (select count(*) from public.products where status = 'active' and samples_given >= total_samples),
    'by_member', (select coalesce(json_agg(t), '[]'::json) from (
        select coalesce(given_by_name, 'Unknown') as name, count(*) as n
        from public.sample_log where not voided group by 1 order by 2 desc limit 20) t),
    'by_product', (select coalesce(json_agg(t), '[]'::json) from (
        select name, count(*) as total, count(*) filter (where samples_given > 0) as given,
               count(*) filter (where samples_given = 0) as left_n
        from public.products
        where status = 'active' and name is not null
        group by name
        order by left_n, name limit 40) t)
  );
end $$;

-- 5k. Admin: start a new event with the SAME printed QR codes.
--     Clears every sample log entry and resets every product's counters to
--     zero, but keeps all products, codes and descriptions exactly as they
--     are -- so labels already stuck on products/boxes stay valid forever
--     and the database never has to grow event after event.
--     ALWAYS download a backup (Admin > Backup) before calling this: it is
--     not reversible from inside the app.
create or replace function public.reset_for_new_event(p_confirm text)
returns json language plpgsql security definer set search_path = public as $$
declare
  n_log int; n_products int;
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if p_confirm <> 'RESET' then
    return json_build_object('ok', false, 'error', 'Type RESET (capitals) to confirm.');
  end if;

  select count(*) into n_log from public.sample_log;
  select count(*) into n_products from public.products where samples_given > 0 or next_sample_no > 1;

  delete from public.sample_log;
  update public.products set samples_given = 0, next_sample_no = 1, updated_at = now()
   where samples_given > 0 or next_sample_no > 1;

  return json_build_object('ok', true, 'cleared_entries', n_log, 'reset_products', n_products);
end $$;

-- ---------------------------------------------------------------------
-- 6. Who may call what
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_team()  to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.scan_product(text) to anon, authenticated;

grant execute on function public.give_sample(text, text, text, text, text, text, uuid, timestamptz) to authenticated;
grant execute on function public.save_product(text, text, text, text, int) to authenticated;
grant execute on function public.get_catalog()            to authenticated;
grant execute on function public.find_recipient(text)     to authenticated;
grant execute on function public.my_recent()              to authenticated;
grant execute on function public.void_sample(uuid, text)  to authenticated;
grant execute on function public.generate_codes(int, text) to authenticated;
grant execute on function public.import_product_catalog(jsonb) to authenticated;
grant execute on function public.get_product_picker()     to authenticated;
grant execute on function public.admin_stats()            to authenticated;
grant execute on function public.reset_for_new_event(text) to authenticated;

-- =====================================================================
--  AFTER running this file, make yourself an admin (replace the email):
--
--    update public.profiles set role = 'admin' where email = 'you@company.com';
--
--  (Create your login first in Authentication > Users > Add user.)
-- =====================================================================
