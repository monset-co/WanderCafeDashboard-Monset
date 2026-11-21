# Wander Dashboard

The team's dashboard for Wander Cafe + B&B: counter register, sales log, inventory, analytics and room bookings.
Separate app from the website (`../WanderCafe-monset`); same brand, same Supabase project once the website goes live.
The register, sales log, inventory and analytics follow CourageD POS; bookings follow the Sermon on the Mount dashboard.

## Who can do what

| | Staff | Manager | Admin |
|---|---|---|---|
| Register (take orders, cash/GCash/Maya/card) | ✓ | ✓ | ✓ |
| Sales log | own receipts | every receipt, voids | every receipt, voids |
| Inventory: receive, write off, count | ✓ | ✓ | ✓ |
| Inventory: add items, prices, food costs | | ✓ | ✓ |
| Bookings: add, confirm, check in/out, take payments, guest details | ✓ | ✓ | ✓ |
| Bookings: change room/dates/price, cancel; edit rooms | | ✓ | ✓ |
| Analytics (cafe + rooms) | | ✓ | ✓ |
| Staff logins and roles | | | ✓ |

The database enforces all of this (row-level security, triggers and functions in `supabase/schema.sql`); the app only hides what a role can't use. New sign-ups get no access. There is always at least one admin. Sales are never edited (voided with a reason), bookings are never deleted (cancelled), and every product and booking change is logged with who made it.

## Set up Supabase (once)

1. Create a new Supabase project (region: Singapore).
2. SQL Editor › New query › paste all of `supabase/schema.sql` › Run. Safe to run again.
3. Authentication › Sign In / Providers: turn **off** "Allow new users to sign up".
4. Authentication › Users › Add user (your email, a password, **Auto Confirm**). Then in SQL Editor:
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'you@example.com');
   ```
   Everyone else is added from the dashboard's Staff page.
5. Project Settings › API: copy the URL, the anon (publishable) key and the service_role (secret) key.

## Run locally

```sh
cp .env.example .env.local   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev                  # npm run dev:tablet to open it from a tablet on the same wifi
npm test                     # schema in a real Postgres (PGlite) + the staff API rules
```

Adding logins and resetting passwords need the server function, so they only work on the deployed site.

## Deploy on Cloudflare Pages

1. Cloudflare › Workers & Pages › Create › Pages › Connect to Git › this repo.
2. Build command `npm run build`, output directory `dist`.
3. Settings › Variables and secrets (Production):
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (plain text)
   - `SUPABASE_SERVICE_ROLE_KEY` (**secret**; used only by `functions/api/staff.js`, which checks the caller is an admin. Never prefix it with `VITE_`.)
4. Custom domains › add e.g. `dashboard.<client-domain>` (the domain is already on Cloudflare, so DNS is automatic).
5. Supabase › Authentication › URL Configuration: set the Site URL to that address.

`public/_headers` sets security headers (CSP allows only this site and `*.supabase.co`); `public/_redirects` sends every path to the app.

## Day to day

- **Menu**: the printed menu is loaded as "made to order" items. Set each item's **food cost** (Inventory › Edit) so Analytics shows real profit; until then profit equals sales. Drink and food options (flavour, waffle or pancake) go in the order's kitchen note; paid extras are the Add-ons items.
- **Stock**: add supplies (beans, milk, cups; any unit, decimals allowed) and ready-to-sell goods (bottled drinks), then Receive the opening stock. Ready-to-sell goods come off stock when sold and go back when a sale is voided. Supplies are counted, not sold.
- **Rooms**: the two website placeholders (Sample Room A/B) are loaded. Managers rename them and set real rates under Bookings › Rooms. Keep the room ids the same as the website's `src/data/rooms.js`.
- **Analytics**: net after waste = gross profit − spoilage and count shortages at cost. Deliveries are shown as cash spent, not subtracted (items become cost when sold). Rooms: occupancy, nights sold, room revenue spread over the nights stayed, average nightly rate.

## When the website goes live

Point it at this same Supabase project and replace its `supabase/schema.sql` tables with these (same `bookings` columns, money in centavos). One change in the website: its PayMongo webhook should set `status = 'confirmed'` and `paid = <amount>` where it now sets `status = 'paid'`. Website bookings then appear in the dashboard live, marked "Website".

## Not built yet

Receipt printer output, expenses and payroll (CourageD has them), recipe-level ingredient deduction (supplies are counted by hand), and showing the website's online cafe orders here.
