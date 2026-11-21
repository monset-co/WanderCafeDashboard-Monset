-- =====================================================================
-- Wander Cafe + B&B dashboard  |  Supabase schema
-- Paste the whole file into Supabase › SQL Editor › New query › Run.
-- Safe to run again. Reports group by Manila calendar days.
--
-- Modeled on CourageD POS (register, sales log, inventory, analytics) and
-- Sermon on the Mount (bookings). Money:
--   POS (products, sales)  numeric pesos, e.g. 129.00
--   rooms.rate             whole pesos per night
--   bookings               integer centavos (total, deposit, paid), the
--                          same as the website's PayMongo checkout
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- 1. STAFF: one profile per login, with a role.
--   admin    everything, plus staff accounts
--   manager  sales log + voids, analytics, products and prices, rooms,
--            and any booking change
--   staff    register, own receipts, stock in/out/counts, bookings
--            (add, confirm, check in/out, take payments)
--   inactive no access (new sign-ups, people who left)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        text not null default 'inactive' check (role in ('admin', 'manager', 'staff', 'inactive')),
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'inactive')
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() = 'admin'
$$;
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() in ('admin', 'manager')
$$;
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() in ('admin', 'manager', 'staff')
$$;

-- Never lose the last admin.
create or replace function public.keep_one_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and new.role <> 'admin'
     and not exists (select 1 from public.profiles where role = 'admin' and id <> old.id) then
    raise exception 'There must always be at least one admin';
  end if;
  return new;
end $$;
drop trigger if exists profiles_keep_one_admin on public.profiles;
create trigger profiles_keep_one_admin
  before update of role on public.profiles
  for each row execute function public.keep_one_admin();

-- Admin only: everyone with their login email and last sign-in (emails live in auth.users).
create or replace function public.staff_list()
returns table (id uuid, email text, full_name text, role text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can manage staff';
  end if;
  return query
    select p.id, u.email::text, p.full_name, p.role, p.created_at, u.last_sign_in_at
      from public.profiles p
      join auth.users u on u.id = p.id
     order by case p.role when 'admin' then 0 when 'manager' then 1 when 'staff' then 2 else 3 end, p.full_name;
end $$;

-- ---------------------------------------------------------------------
-- 2. PRODUCTS
--   made    menu item made to order: sold, no stock count
--   good    bought ready to sell (bottled drinks, snacks): sold and counted
--   supply  ingredients and packaging (beans, milk, cups): counted, never sold
-- unit_cost of a made item is its estimated food cost, for gross profit.
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null check (length(trim(name)) > 0),
  category       text not null default 'Other',
  kind           text not null default 'made' check (kind in ('made', 'good', 'supply')),
  unit           text not null default 'pc',              -- pc, kg, L, pack…
  unit_cost      numeric(10,2) not null default 0 check (unit_cost >= 0),
  selling_price  numeric(10,2) not null default 0 check (selling_price >= 0),
  stock_qty      numeric(12,2) not null default 0,        -- only moves through stock_movements
  reorder_level  numeric(12,2) not null default 0,
  is_active      boolean not null default true,           -- hide instead of delete
  sort           integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists products_updated_at on public.products;
create trigger products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- Every change to a product, with who and when. Written only by the trigger.
create table if not exists public.product_changes (
  id          bigint generated always as identity primary key,
  product_id  uuid not null references public.products(id) on delete cascade,
  field       text not null,
  old_value   text,
  new_value   text,
  changed_by  uuid references auth.users(id),
  changed_at  timestamptz not null default now()
);
create index if not exists product_changes_prod_idx on public.product_changes (product_id, changed_at desc);

create or replace function public.log_product_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f text;
begin
  if tg_op = 'INSERT' then
    insert into public.product_changes (product_id, field, new_value, changed_by)
    values (new.id, 'created', new.name, auth.uid());
    return new;
  end if;
  foreach f in array array['name', 'code', 'category', 'kind', 'unit', 'unit_cost', 'selling_price', 'reorder_level', 'is_active'] loop
    if (to_jsonb(old) ->> f) is distinct from (to_jsonb(new) ->> f) then
      insert into public.product_changes (product_id, field, old_value, new_value, changed_by)
      values (new.id, f, to_jsonb(old) ->> f, to_jsonb(new) ->> f, auth.uid());
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists products_log_change on public.products;
create trigger products_log_change
  after insert or update on public.products
  for each row execute function public.log_product_change();

-- ---------------------------------------------------------------------
-- 3. SALES: one row per receipt, one sale_items row per line.
-- Prices and costs are copied onto the line at the moment of sale, so a
-- later price change never rewrites old reports.
-- ---------------------------------------------------------------------
create table if not exists public.sales (
  id               uuid primary key default gen_random_uuid(),
  sale_no          bigint generated always as identity unique,
  sold_at          timestamptz not null default now(),
  payment_method   text not null default 'cash'
                   check (payment_method in ('cash', 'gcash', 'maya', 'card', 'bank_transfer', 'other')),
  payment_ref      text,                                  -- GCash: last 4 digits of the reference
  subtotal         numeric(10,2) not null default 0 check (subtotal >= 0),
  discount         numeric(10,2) not null default 0 check (discount >= 0),
  total            numeric(10,2) not null default 0 check (total >= 0),
  amount_tendered  numeric(10,2),
  change_due       numeric(10,2),
  customer_name    text,
  note             text,
  status           text not null default 'completed' check (status in ('completed', 'voided')),
  voided_at        timestamptz,
  voided_by        uuid references auth.users(id),
  void_reason      text,
  staff_id         uuid references auth.users(id) default auth.uid(),
  client_ref       uuid unique,                           -- one per checkout: a retry never doubles a sale
  created_at       timestamptz not null default now()
);

create table if not exists public.sale_items (
  id            uuid primary key default gen_random_uuid(),
  sale_id       uuid not null references public.sales(id) on delete cascade,
  product_id    uuid not null references public.products(id) on delete restrict,
  product_code  text not null,
  product_name  text not null,
  qty           integer not null check (qty > 0),
  unit_price    numeric(10,2) not null,
  unit_cost     numeric(10,2) not null,
  line_total    numeric(12,2) generated always as (qty * unit_price) stored,
  line_cost     numeric(12,2) generated always as (qty * unit_cost) stored,
  line_profit   numeric(12,2) generated always as (qty * (unit_price - unit_cost)) stored
);

-- ---------------------------------------------------------------------
-- 4. STOCK MOVEMENTS: every change to stock, signed by who made it.
--   purchase / void   stock in (positive)
--   sale / spoilage   stock out (negative)
--   adjustment        a shelf count's difference (set_stock_count only)
-- ---------------------------------------------------------------------
create table if not exists public.stock_movements (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.products(id) on delete restrict,
  movement_type  text not null check (movement_type in ('purchase', 'sale', 'void', 'spoilage', 'adjustment')),
  qty            numeric(12,2) not null check (qty <> 0),
  unit_cost      numeric(10,2),
  supplier       text,
  note           text,
  sale_id        uuid references public.sales(id) on delete set null,
  created_by     uuid references auth.users(id) default auth.uid(),
  occurred_at    timestamptz not null default now(),
  constraint movement_direction check (
       (movement_type in ('purchase', 'void') and qty > 0)
    or (movement_type in ('sale', 'spoilage') and qty < 0)
    or (movement_type = 'adjustment')
  )
);

-- Keeps products.stock_qty in step. A delivery with a cost also sets the latest buying price.
create or replace function public.apply_stock_movement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.products
     set stock_qty = stock_qty + new.qty,
         unit_cost = case when new.movement_type = 'purchase' and new.unit_cost is not null then new.unit_cost else unit_cost end
   where id = new.product_id and kind in ('good', 'supply');
  return new;
end $$;
drop trigger if exists stock_movements_apply on public.stock_movements;
create trigger stock_movements_apply
  after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

create index if not exists sales_sold_at_idx        on public.sales (sold_at);
create index if not exists sales_staff_idx          on public.sales (staff_id, sold_at);
create index if not exists sale_items_sale_idx      on public.sale_items (sale_id);
create index if not exists sale_items_product_idx   on public.sale_items (product_id);
create index if not exists stock_movements_prod_idx on public.stock_movements (product_id, occurred_at);

-- ---------------------------------------------------------------------
-- 5. CHECKOUT, VOID, COUNT
-- ---------------------------------------------------------------------

-- The Charge button. All or nothing. Prices come from products, never from the browser.
-- p_items: [{"product_id": "uuid", "qty": 2}, ...]
create or replace function public.record_sale(
  p_items            jsonb,
  p_payment_method   text    default 'cash',
  p_discount         numeric default 0,
  p_amount_tendered  numeric default null,
  p_customer_name    text    default null,
  p_note             text    default null,
  p_client_ref       uuid    default null,
  p_payment_ref      text    default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_sale_id   uuid;
  v_item      jsonb;
  v_product   public.products%rowtype;
  v_qty       integer;
  v_subtotal  numeric := 0;
  v_discount  numeric := coalesce(p_discount, 0);
  v_total     numeric;
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;

  -- A retry of a checkout that already went through gets that sale back.
  if p_client_ref is not null then
    select id into v_sale_id from public.sales where client_ref = p_client_ref;
    if found then
      return v_sale_id;
    end if;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;
  if p_payment_method = 'gcash' and coalesce(p_payment_ref, '') !~ '^\d{4}$' then
    raise exception 'Enter the last 4 digits of the GCash reference';
  end if;
  if v_discount < 0 then
    raise exception 'Discount cannot be negative';
  end if;

  insert into public.sales (payment_method, payment_ref, discount, customer_name, note, staff_id, client_ref)
  values (p_payment_method, case when p_payment_method = 'gcash' then p_payment_ref end, v_discount,
          nullif(trim(p_customer_name), ''), nullif(trim(p_note), ''), auth.uid(), p_client_ref)
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity in cart';
    end if;

    select * into v_product from public.products
     where id = (v_item->>'product_id')::uuid and is_active
       for update;
    if not found then
      raise exception 'Product not found or hidden';
    end if;
    if v_product.kind = 'supply' then
      raise exception '% is a supply, not something on the menu', v_product.name;
    end if;
    if v_product.kind = 'good' and v_product.stock_qty < v_qty then
      raise exception 'Not enough stock for % (have %, need %)', v_product.name, v_product.stock_qty::int, v_qty;
    end if;

    insert into public.sale_items (sale_id, product_id, product_code, product_name, qty, unit_price, unit_cost)
    values (v_sale_id, v_product.id, v_product.code, v_product.name, v_qty, v_product.selling_price, v_product.unit_cost);

    if v_product.kind = 'good' then
      insert into public.stock_movements (product_id, movement_type, qty, unit_cost, sale_id, created_by)
      values (v_product.id, 'sale', -v_qty, v_product.unit_cost, v_sale_id, auth.uid());
    end if;

    v_subtotal := v_subtotal + v_qty * v_product.selling_price;
  end loop;

  if v_discount > v_subtotal then
    raise exception 'Discount is larger than the subtotal';
  end if;
  v_total := v_subtotal - v_discount;
  if p_amount_tendered is not null and p_amount_tendered < v_total then
    raise exception 'Cash received (%) is less than the total (%)', p_amount_tendered, v_total;
  end if;

  update public.sales
     set subtotal = v_subtotal,
         total = v_total,
         amount_tendered = p_amount_tendered,
         change_due = case when p_amount_tendered is not null then p_amount_tendered - v_total end
   where id = v_sale_id;
  return v_sale_id;
end $$;

-- Managers only. The receipt stays, marked voided; stock goes back.
create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_line   record;
begin
  if not public.is_manager() then
    raise exception 'Only a manager can void a sale';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to void a sale';
  end if;
  select status into v_status from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale not found';
  end if;
  if v_status = 'voided' then
    raise exception 'This sale is already voided';
  end if;

  update public.sales
     set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
   where id = p_sale_id;

  for v_line in
    select si.product_id, si.qty, si.unit_cost
      from public.sale_items si join public.products p on p.id = si.product_id
     where si.sale_id = p_sale_id and p.kind = 'good'
  loop
    insert into public.stock_movements (product_id, movement_type, qty, unit_cost, sale_id, note, created_by)
    values (v_line.product_id, 'void', v_line.qty, v_line.unit_cost, p_sale_id, 'Void: ' || trim(p_reason), auth.uid());
  end loop;
end $$;

-- "We counted 18 on the shelf." Records the difference under a row lock. Returns the difference.
create or replace function public.set_stock_count(p_product_id uuid, p_counted numeric, p_note text default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_stock numeric;
  v_kind  text;
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  if p_counted is null or p_counted < 0 then
    raise exception 'The count must be zero or more';
  end if;
  select stock_qty, kind into v_stock, v_kind from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Product not found';
  end if;
  if v_kind = 'made' then
    raise exception 'Made-to-order items have no stock to count';
  end if;
  if p_counted <> v_stock then
    insert into public.stock_movements (product_id, movement_type, qty, note, created_by)
    values (p_product_id, 'adjustment', p_counted - v_stock,
            coalesce(nullif(trim(p_note), ''), 'Count: ' || v_stock || ' → ' || p_counted), auth.uid());
  end if;
  return p_counted - v_stock;
end $$;

-- ---------------------------------------------------------------------
-- 6. ROOMS AND BOOKINGS (Sermon on the Mount model, website-compatible)
-- ---------------------------------------------------------------------
create table if not exists public.rooms (
  id          text primary key check (id ~ '^[a-z0-9-]+$'),   -- same ids as the website's src/data/rooms.js
  name        text not null,
  bed         text not null default '',
  max_guests  integer not null default 2 check (max_guests between 1 and 20),
  rate        integer not null default 0 check (rate >= 0),  -- whole pesos per night
  color       text not null default '#4f8f8a' check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_active   boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.bookings (
  id          bigint generated always as identity primary key,
  ref         text not null unique default ('WDR-' || upper(substr(md5(gen_random_uuid()::text), 1, 6))),
  room_id     text not null references public.rooms(id),
  check_in    date not null,
  check_out   date not null,
  guests      integer not null default 1 check (guests between 1 and 20),
  name        text not null check (length(trim(name)) between 2 and 120),
  email       text not null default '',
  phone       text not null default '',
  notes       text not null default '' check (length(notes) <= 2000),
  total       integer not null default 0 check (total >= 0),    -- centavos
  deposit     integer not null default 0 check (deposit >= 0),  -- centavos
  paid        integer not null default 0 check (paid >= 0),     -- centavos
  -- pending      website checkout holding the dates while the guest pays
  -- confirmed    reserved (deposit paid online, or taken by the team)
  -- checked_in / checked_out
  -- cancelled, expired (hold lapsed), conflict (paid after the hold lapsed: refund)
  status      text not null default 'pending'
              check (status in ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'expired', 'conflict')),
  source      text not null default 'web' check (source in ('web', 'walk_in', 'phone', 'facebook', 'other')),
  payment_id  text,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint bookings_dates check (check_out > check_in),
  -- The double-booking guard: two live bookings of one room never overlap (check-out day is free).
  constraint no_double_booking exclude using gist (
    room_id with =,
    daterange(check_in, check_out) with &&
  ) where (status in ('pending', 'confirmed', 'checked_in'))
);
create index if not exists bookings_check_in_idx on public.bookings (check_in);
create index if not exists bookings_check_out_idx on public.bookings (check_out, status);

-- Staff run the bookings day to day; the room, dates, price and cancelling are a manager's call.
-- No signed-in user (the website's server key, the SQL editor) passes through.
create or replace function public.booking_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_manager() then
    return new;
  end if;
  if tg_op = 'UPDATE' and (
       new.room_id is distinct from old.room_id or new.check_in is distinct from old.check_in
    or new.check_out is distinct from old.check_out or new.total is distinct from old.total
    or new.deposit is distinct from old.deposit) then
    raise exception 'Only a manager can change the room, dates or price';
  end if;
  if new.status = 'cancelled' and (tg_op = 'INSERT' or old.status <> 'cancelled') then
    raise exception 'Only a manager can cancel a booking';
  end if;
  return new;
end $$;
drop trigger if exists bookings_guard on public.bookings;
create trigger bookings_guard
  before insert or update on public.bookings
  for each row execute function public.booking_guard();

create table if not exists public.booking_changes (
  id          bigint generated always as identity primary key,
  booking_id  bigint not null references public.bookings(id) on delete cascade,
  field       text not null,
  old_value   text,
  new_value   text,
  changed_by  uuid references auth.users(id),
  changed_at  timestamptz not null default now()
);
create index if not exists booking_changes_idx on public.booking_changes (booking_id, changed_at desc);

create or replace function public.log_booking_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f text;
begin
  if tg_op = 'INSERT' then
    insert into public.booking_changes (booking_id, field, new_value, changed_by)
    values (new.id, 'created', new.status, auth.uid());
    return new;
  end if;
  foreach f in array array['status', 'paid', 'room_id', 'check_in', 'check_out', 'guests', 'total', 'deposit', 'name', 'phone', 'email', 'notes'] loop
    if (to_jsonb(old) ->> f) is distinct from (to_jsonb(new) ->> f) then
      insert into public.booking_changes (booking_id, field, old_value, new_value, changed_by)
      values (new.id, f, to_jsonb(old) ->> f, to_jsonb(new) ->> f, auth.uid());
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists bookings_log_change on public.bookings;
create trigger bookings_log_change
  after insert or update on public.bookings
  for each row execute function public.log_booking_change();

-- ---------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.products        enable row level security;
alter table public.product_changes enable row level security;
alter table public.sales           enable row level security;
alter table public.sale_items      enable row level security;
alter table public.stock_movements enable row level security;
alter table public.rooms           enable row level security;
alter table public.bookings        enable row level security;
alter table public.booking_changes enable row level security;

drop policy if exists "profiles read" on public.profiles;
drop policy if exists "profiles admin" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy "profiles admin" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name, role) on public.profiles to authenticated;

drop policy if exists "products read" on public.products;
drop policy if exists "products insert" on public.products;
drop policy if exists "products update" on public.products;
create policy "products read" on public.products for select to authenticated using (public.is_staff());
create policy "products insert" on public.products for insert to authenticated with check (public.is_manager());
create policy "products update" on public.products for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
-- stock_qty is never written directly: it only moves through stock_movements.
revoke insert, update, delete on public.products from anon, authenticated;
grant insert (code, name, category, kind, unit, unit_cost, selling_price, reorder_level, is_active, sort) on public.products to authenticated;
grant update (code, name, category, kind, unit, unit_cost, selling_price, reorder_level, is_active, sort) on public.products to authenticated;

drop policy if exists "product changes read" on public.product_changes;
create policy "product changes read" on public.product_changes for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.product_changes from anon, authenticated;

-- Staff see their own receipts; managers see all. Writes only via record_sale / void_sale.
drop policy if exists "sales read" on public.sales;
create policy "sales read" on public.sales for select to authenticated
  using (public.is_manager() or (public.is_staff() and staff_id = auth.uid()));
revoke insert, update, delete on public.sales from anon, authenticated;

drop policy if exists "sale items read" on public.sale_items;
create policy "sale items read" on public.sale_items for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));
revoke insert, update, delete on public.sale_items from anon, authenticated;

-- Deliveries and spoilage by hand; sales, voids and counts come from the functions above.
drop policy if exists "stock read" on public.stock_movements;
drop policy if exists "stock insert" on public.stock_movements;
create policy "stock read" on public.stock_movements for select to authenticated using (public.is_staff());
create policy "stock insert" on public.stock_movements for insert to authenticated
  with check (created_by = auth.uid() and sale_id is null and public.is_staff() and movement_type in ('purchase', 'spoilage'));
revoke update, delete on public.stock_movements from anon, authenticated;

drop policy if exists "rooms read" on public.rooms;
drop policy if exists "rooms insert" on public.rooms;
drop policy if exists "rooms update" on public.rooms;
create policy "rooms read" on public.rooms for select to authenticated using (public.is_staff());
create policy "rooms insert" on public.rooms for insert to authenticated with check (public.is_manager());
create policy "rooms update" on public.rooms for update to authenticated using (public.is_manager()) with check (public.is_manager());
revoke delete on public.rooms from anon, authenticated;

-- Bookings are never deleted: cancelled instead, with the change log kept.
drop policy if exists "bookings read" on public.bookings;
drop policy if exists "bookings insert" on public.bookings;
drop policy if exists "bookings update" on public.bookings;
create policy "bookings read" on public.bookings for select to authenticated using (public.is_staff());
create policy "bookings insert" on public.bookings for insert to authenticated
  with check (public.is_staff() and created_by = auth.uid() and source <> 'web');
create policy "bookings update" on public.bookings for update to authenticated using (public.is_staff()) with check (public.is_staff());
-- Column grants: the ref, source, author and payment id are fixed once written.
revoke update, delete on public.bookings from anon, authenticated;
grant update (room_id, check_in, check_out, guests, name, email, phone, notes, total, deposit, paid, status)
  on public.bookings to authenticated;

drop policy if exists "booking changes read" on public.booking_changes;
create policy "booking changes read" on public.booking_changes for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.booking_changes from anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. REPORTS (managers). One call per tab, so the browser never pulls
-- raw rows (Supabase caps those at 1,000 per request).
-- ---------------------------------------------------------------------
create or replace view public.v_sale_totals with (security_invoker = true) as
select
  s.id, s.sale_no, s.sold_at,
  (s.sold_at at time zone 'Asia/Manila')       as sold_at_local,
  (s.sold_at at time zone 'Asia/Manila')::date as sale_date,
  s.payment_method, s.subtotal, s.discount, s.total, s.status, s.staff_id,
  coalesce(sum(si.line_cost), 0)           as cost,
  s.total - coalesce(sum(si.line_cost), 0) as gross_profit,
  coalesce(sum(si.qty), 0)                 as items_count
from public.sales s
left join public.sale_items si on si.sale_id = s.id
group by s.id;

create or replace function public.sales_report(p_from date, p_to date)
returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_days integer;
  v jsonb;
begin
  if not public.is_manager() then
    raise exception 'Only a manager can view reports';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Pick a valid date range';
  end if;
  v_days := p_to - p_from + 1;
  if v_days > 732 then
    raise exception 'Pick a range of two years or less';
  end if;

  with
  s    as (select * from public.v_sale_totals where sale_date between p_from and p_to),
  done as (select * from s where status = 'completed'),
  prev as (select * from public.v_sale_totals where status = 'completed' and sale_date between p_from - v_days and p_from - 1),
  li   as (
    select si.product_id, si.product_code, si.product_name, si.qty, si.line_total, si.line_profit,
           p.category, d.sale_date, d.staff_id
      from public.sale_items si
      join done d on d.id = si.sale_id
      join public.products p on p.id = si.product_id
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'totals', (select jsonb_build_object(
        'revenue', coalesce(sum(total), 0), 'cost', coalesce(sum(cost), 0), 'gross_profit', coalesce(sum(gross_profit), 0),
        'receipts', count(*), 'items', coalesce(sum(items_count), 0), 'discounts', coalesce(sum(discount), 0))
      from done),
    'previous', (select jsonb_build_object(
        'revenue', coalesce(sum(total), 0), 'gross_profit', coalesce(sum(gross_profit), 0),
        'receipts', count(*), 'items', coalesce(sum(items_count), 0))
      from prev),
    'voids', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(total), 0)) from s where status = 'voided'),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', g.d::date, 'revenue', coalesce(x.revenue, 0), 'profit', coalesce(x.profit, 0), 'receipts', coalesce(x.receipts, 0))
             order by g.d), '[]'::jsonb)
        from generate_series(p_from, p_to, interval '1 day') as g(d)
        left join (select sale_date, sum(total) as revenue, sum(gross_profit) as profit, count(*) as receipts
                     from done group by sale_date) x on x.sale_date = g.d::date),
    'payments', (
      select coalesce(jsonb_agg(jsonb_build_object('method', payment_method, 'total', t, 'receipts', n) order by t desc), '[]'::jsonb)
        from (select payment_method, sum(total) as t, count(*) as n from done group by payment_method) q),
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'hour', hr, 'receipts', n, 'revenue', r)), '[]'::jsonb)
        from (select extract(dow from sold_at_local)::int as dow, extract(hour from sold_at_local)::int as hr, count(*) as n, sum(total) as r
                from done group by 1, 2) q),
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object('category', category, 'revenue', r, 'profit', pr, 'units', u) order by r desc), '[]'::jsonb)
        from (select category, sum(line_total) as r, sum(line_profit) as pr, sum(qty) as u from li group by category) q),
    'products', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'product_id', product_id, 'code', product_code, 'name', product_name, 'category', category,
               'units', u, 'revenue', r, 'profit', pr) order by r desc), '[]'::jsonb)
        from (select product_id, product_code, product_name, category, sum(qty) as u, sum(line_total) as r, sum(line_profit) as pr
                from li group by product_id, product_code, product_name, category) q),
    'staff', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'staff_id', staff_id, 'name', name, 'role', role, 'receipts', n, 'revenue', r, 'profit', pr, 'items', it, 'discounts', dc)
             order by r desc), '[]'::jsonb)
        from (select d.staff_id, coalesce(pf.full_name, 'Unknown') as name, pf.role,
                     count(*) as n, sum(d.total) as r, sum(d.gross_profit) as pr, sum(d.items_count) as it, sum(d.discount) as dc
                from done d left join public.profiles pf on pf.id = d.staff_id
               group by d.staff_id, pf.full_name, pf.role) q)
  ) into v;
  return v;
end $$;

-- Deliveries are cash spent, not a cost (goods become cost when sold).
-- Losses = spoilage and count shortages at cost, taken off net profit.
create or replace function public.stock_report(p_from date, p_to date)
returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_days integer := p_to - p_from + 1;
begin
  if not public.is_manager() then
    raise exception 'Only a manager can view reports';
  end if;
  return (
    -- ponytail: spoilage and counts carry no cost of their own, so they use the product's current cost.
    with m as (
      select (sm.occurred_at at time zone 'Asia/Manila')::date as d,
             sm.movement_type = 'purchase' as bought,
             sm.qty * coalesce(sm.unit_cost, p.unit_cost) as v
        from public.stock_movements sm
        join public.products p on p.id = sm.product_id
       where sm.movement_type in ('purchase', 'spoilage', 'adjustment')
         and (sm.occurred_at at time zone 'Asia/Manila')::date between p_from - v_days and p_to
    )
    select jsonb_build_object(
      'purchases', coalesce(sum(v) filter (where bought and d >= p_from), 0),
      'losses', coalesce(-sum(v) filter (where not bought and d >= p_from), 0),
      'previous_losses', coalesce(-sum(v) filter (where not bought and d < p_from), 0),
      'daily', (
        select coalesce(jsonb_agg(jsonb_build_object('date', d, 'purchases', pu, 'losses', lo) order by d), '[]'::jsonb)
          from (select d, coalesce(sum(v) filter (where bought), 0) as pu, coalesce(-sum(v) filter (where not bought), 0) as lo
                  from m where d >= p_from group by d) q))
    from m
  );
end $$;

-- Rooms: nights sold in the range (a stay is counted for each night inside it),
-- occupancy, room revenue spread evenly over a stay's nights, average rate, by room and source.
create or replace function public.bookings_report(p_from date, p_to date)
returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_days integer := p_to - p_from + 1;
begin
  if not public.is_manager() then
    raise exception 'Only a manager can view reports';
  end if;
  if p_from is null or p_to is null or p_to < p_from or v_days > 732 then
    raise exception 'Pick a valid date range of two years or less';
  end if;
  return (
    with
    sold as (
      select b.*, (b.check_out - b.check_in) as stay_nights
        from public.bookings b
       where b.status in ('confirmed', 'checked_in', 'checked_out')
         and b.check_in <= p_to and b.check_out > p_from
    ),
    nights as (  -- one row per booked night inside the range
      select s.id, s.room_id, s.source, g.d::date as night, s.total::numeric / s.stay_nights as rev
        from sold s, generate_series(greatest(s.check_in, p_from), least(s.check_out - 1, p_to), interval '1 day') g(d)
    ),
    rooms as (select count(*) as n from public.rooms where is_active)
    select jsonb_build_object(
      'from', p_from, 'to', p_to,
      'rooms', (select n from rooms),
      'nights_sold', (select count(*) from nights),
      'nights_available', (select n from rooms) * v_days,
      'revenue', (select coalesce(round(sum(rev)), 0) from nights),             -- centavos
      'bookings', (select count(*) from sold where check_in between p_from and p_to),
      'cancelled', (select count(*) from public.bookings where status = 'cancelled' and check_in between p_from and p_to),
      'daily', (
        select coalesce(jsonb_agg(jsonb_build_object('date', g.d::date, 'occupied', coalesce(x.n, 0), 'revenue', coalesce(x.r, 0)) order by g.d), '[]'::jsonb)
          from generate_series(p_from, p_to, interval '1 day') g(d)
          left join (select night, count(*) as n, round(sum(rev)) as r from nights group by night) x on x.night = g.d::date),
      'by_room', (
        select coalesce(jsonb_agg(jsonb_build_object('room_id', r.id, 'name', r.name, 'color', r.color, 'nights', coalesce(x.n, 0), 'revenue', coalesce(x.r, 0)) order by r.sort, r.name), '[]'::jsonb)
          from public.rooms r
          left join (select room_id, count(*) as n, round(sum(rev)) as r from nights group by room_id) x on x.room_id = r.id
         where r.is_active or x.n > 0),
      'by_source', (
        select coalesce(jsonb_agg(jsonb_build_object('source', source, 'bookings', n) order by n desc), '[]'::jsonb)
          from (select source, count(*) as n from sold where check_in between p_from and p_to group by source) q)
    )
  );
end $$;

revoke all on function public.record_sale(jsonb, text, numeric, numeric, text, text, uuid, text) from public, anon;
revoke all on function public.void_sale(uuid, text) from public, anon;
revoke all on function public.set_stock_count(uuid, numeric, text) from public, anon;
revoke all on function public.sales_report(date, date) from public, anon;
revoke all on function public.stock_report(date, date) from public, anon;
revoke all on function public.bookings_report(date, date) from public, anon;
revoke all on function public.staff_list() from public, anon;
grant execute on function public.record_sale(jsonb, text, numeric, numeric, text, text, uuid, text) to authenticated;
grant execute on function public.void_sale(uuid, text) to authenticated;
grant execute on function public.set_stock_count(uuid, numeric, text) to authenticated;
grant execute on function public.sales_report(date, date) to authenticated;
grant execute on function public.stock_report(date, date) to authenticated;
grant execute on function public.bookings_report(date, date) to authenticated;
grant execute on function public.staff_list() to authenticated;

-- ---------------------------------------------------------------------
-- 9. LIVE UPDATES (Sales log and Bookings refresh by themselves)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['sales', 'bookings'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 10. STARTING DATA: the printed menu and the website's placeholder rooms.
-- Food costs start at 0: set each item's cost in Inventory so profit is real.
-- ---------------------------------------------------------------------
insert into public.rooms (id, name, bed, max_guests, rate, color, sort) values
  ('room-a', 'Sample Room A', 'Queen bed',   2, 1800, '#4f8f8a', 1),
  ('room-b', 'Sample Room B', 'Family room', 4, 3200, '#b0703c', 2)
on conflict (id) do nothing;

insert into public.products (code, name, category, kind, selling_price, sort) values
  ('CC01', 'Wander Signature Breakfast', 'Classic Comforts', 'made', 295, 1),
  ('CC02', 'Rise & Shine Breakfast',     'Classic Comforts', 'made', 295, 2),
  ('CC03', 'Ramen',                      'Classic Comforts', 'made', 120, 3),
  ('SW01', 'Waffle Hearts',              'Sweet Treats',     'made', 165, 1),
  ('SW02', 'Pancake Haven',              'Sweet Treats',     'made', 165, 2),
  ('SW03', 'Yogurt Parfait',             'Sweet Treats',     'made', 145, 3),
  ('FP01', 'Corned Beef Plate',          'Filipino Plates',  'made', 195, 1),
  ('FP02', 'Tocino Plate',               'Filipino Plates',  'made', 195, 2),
  ('FP03', 'Spam Plate',                 'Filipino Plates',  'made', 195, 3),
  ('FP04', 'Hotdog Plate',               'Filipino Plates',  'made', 195, 4),
  ('FP05', 'Ham Plate',                  'Filipino Plates',  'made', 195, 5),
  ('FP06', 'Chorizo Plate',              'Filipino Plates',  'made', 195, 6),
  ('FP07', 'Sardines Run Plate',         'Filipino Plates',  'made', 195, 7),
  ('CM01', 'Bacon + Longaniza',          'Combo Meals',      'made', 245, 1),
  ('CM02', 'Sausage + Ham',              'Combo Meals',      'made', 245, 2),
  ('SN01', 'Spam & Jam',                 'Sandwiches',       'made', 159, 1),
  ('SN02', 'Mango Cream Cheese',         'Sandwiches',       'made', 159, 2),
  ('SN03', 'Tuna Melt',                  'Sandwiches',       'made', 149, 3),
  ('SN04', 'Ham & Egg',                  'Sandwiches',       'made', 145, 4),
  ('SN05', 'Egg & Cheese',               'Sandwiches',       'made', 129, 5),
  ('PA01', 'Creamy Carbonara',           'Pasta',            'made', 229, 1),
  ('PA02', 'Pasta Sardines',             'Pasta',            'made', 185, 2),
  ('PA03', 'Bolognese',                  'Pasta',            'made', 259, 3),
  ('PA04', 'Asian Beef Pasta',           'Pasta',            'made', 259, 4),
  ('PA05', 'Beef Penne',                 'Pasta',            'made', 259, 5),
  ('PA06', 'Sotanghon',                  'Pasta',            'made', 249, 6),
  ('BW01', 'Special Ramen',              'Comfort Bowls',    'made', 159, 1),
  ('BW02', 'Special Pancit Canton',      'Comfort Bowls',    'made', 135, 2),
  ('BW03', 'Vietnamese Pho',             'Comfort Bowls',    'made', 315, 3),
  ('HH01', 'Classic Halo Halo',          'Halo Halo',        'made', 120, 1),
  ('CF01', 'Espresso',                   'Coffee',           'made',  90, 1),
  ('CF02', 'Americano',                  'Coffee',           'made', 105, 2),
  ('CF03', 'Pour Over',                  'Coffee',           'made', 145, 3),
  ('CF04', 'Latte',                      'Coffee',           'made', 130, 4),
  ('CF05', 'Cappuccino',                 'Coffee',           'made', 139, 5),
  ('CF06', 'Caramel Macchiato',          'Coffee',           'made', 159, 6),
  ('CF07', 'Spanish Latte',              'Coffee',           'made', 139, 7),
  ('CF08', 'Hazelnut Latte',             'Coffee',           'made', 145, 8),
  ('CF09', 'Vanilla Latte',              'Coffee',           'made', 195, 9),
  ('CF10', 'Vietnamese Coffee',          'Coffee',           'made', 159, 10),
  ('CF11', 'Mocha',                      'Coffee',           'made', 145, 11),
  ('SG01', 'Sunrise Spice',              'Signatures',       'made', 165, 1),
  ('SG02', 'Orange Americano',           'Signatures',       'made', 155, 2),
  ('SG03', 'Coconut Americano',          'Signatures',       'made', 165, 3),
  ('SG04', 'Strawberry Latte',           'Signatures',       'made', 165, 4),
  ('SG05', 'Rose Latte',                 'Signatures',       'made', 165, 5),
  ('SG06', 'Mango Latte',                'Signatures',       'made', 165, 6),
  ('NC01', 'Fruit Shake',                'Non-Coffee',       'made', 115, 1),
  ('NC02', 'Oreo Smoothie',              'Non-Coffee',       'made', 115, 2),
  ('NC03', 'Money Business',             'Non-Coffee',       'made', 125, 3),
  ('NC04', 'Strawberry Daydream',        'Non-Coffee',       'made', 125, 4),
  ('NC05', 'Red Velvet Crush',           'Non-Coffee',       'made', 125, 5),
  ('NC06', 'Matcha Latte',               'Non-Coffee',       'made', 135, 6),
  ('NC07', 'Strawberry Matcha',          'Non-Coffee',       'made', 165, 7),
  ('NC08', 'Golden Milk / Pink Milk',    'Non-Coffee',       'made',  99, 8),
  ('AD01', 'Add black coffee or juice',  'Add-ons',          'made',  50, 1),
  ('AD02', 'Add cheese slice',           'Add-ons',          'made',  20, 2)
on conflict (code) do nothing;

notify pgrst, 'reload schema';

-- =====================================================================
-- AFTER RUNNING
-- 1. Authentication › Sign In / Providers: turn OFF "Allow new users to sign up".
-- 2. Authentication › Users › Add user (yourself, auto-confirm), then make yourself admin:
--      update public.profiles set role = 'admin'
--      where id = (select id from auth.users where email = 'you@example.com');
-- Everyone after that is added from the dashboard's Staff page.
-- =====================================================================
