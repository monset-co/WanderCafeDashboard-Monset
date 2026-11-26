# Website ↔ dashboard

The website (`WanderCafe-monset`, its own Cloudflare Worker) runs on **this** Supabase project. This repo owns the schema; the website only reads Inventory and writes pre-orders. For now the website is ordering only: room booking is built on both sides but switched off on the website.

## What flows where

- **Inventory → website.** The website's menu (`src/data/menu.js`) gives every item a POS `code` (CC01, FP02…). Its `/api/menu` reads `products` (code, `selling_price`, `is_active`, everything but supplies), and its checkout charges those prices.
  - Change a price in Inventory and the website shows it within about a minute.
  - Switch an item off (inactive) and it disappears from the website. A switched-off choice, such as one Filipino plate (FP01–FP07) or an add-on (AD01, AD02), shows as *sold out* there.
  - A code the website uses that isn't in Inventory: that item simply doesn't show online.
- **Website → order board.** Checkout saves the order in `orders` as `pending`, with each line as `{ code, label, unit, qty, extras }`. PayMongo's paid webhook then calls `record_web_order` (`supabase/schema.sql` section 12). That rings it up through `record_sale` as a normal POS sale. It shows on the order board on the day it's wanted, as *Website*, with the pick-up time, phone and notes, and counts in Sales and Analytics.
- **Room bookings (when switched on).** A paid booking calls `confirm_web_booking` and shows in Bookings as *Confirmed · Website*, with its 50% deposit recorded.

Only the service key can call `record_web_order` and `confirm_web_booking`. Signed-in staff can't confirm a payment or create a web order.

## Adding or changing menu items

1. Add the product in Inventory (kind *made*, its price).
2. In the website repo, add the item to `src/data/menu.js` with the same `code`, plus a photo in `public/food/`. Then deploy the website.

Choices that are their own products carry their own `code` on the website: each ulam is FP01–FP07, and the Crispy Pata group meal is NW03. Paid add-ons carry `extra` (AD01, AD02). Free choices, like Spicy/Mild, ride along in the kitchen note.

## Setup (once)

1. **Inventory.** The seed in `supabase/schema.sql` section 11 includes the website's What's New items (NW01–NW05). On a project created before they were added, run the website's `supabase/dashboard-new-items.sql` in the SQL editor.
   - Do **not** run the website's old `supabase/schema.sql`; this project already has `orders` and `bookings`.
2. **Website Worker secrets.** Use the same `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as this dashboard's Worker (see the website's README for the rest).
3. **Notifications.** In Supabase › Database › Webhooks, add an **Update** webhook on table `orders`, HTTP POST to `https://dashboard.wanderbyfleur.com/api/notify` with header `x-webhook-secret: <WEBHOOK_SECRET>`.
   - When booking goes online, add the same on table `bookings`, and delete any old *Insert* webhook on `bookings`.
4. **Test** with a PayMongo test payment: order a coffee for today. It should appear on the order board as *Website*, and the team gets a push.

## Things to know

- **Prices.** The website charges the Inventory price at checkout. If a price changes between checkout and payment, the sale's note says `PAID ONLINE P…, POS PRICE P…`.
- **Unknown codes.** If an order line's code isn't an active product by the time it's paid, the order still goes through and its note says `NOT ON THE POS MENU`. An order with no known items at all is refused, so PayMongo keeps retrying until someone fixes it.
- **Late booking payments (when booking is on).** Paid after the 30-minute hold lapsed and the nights were taken: the booking becomes *Conflict*, meaning a refund is due. A booking a manager cancelled stays cancelled, even if a late payment arrives.
- `dashboard.js` beside this file is the reference for the payment call the website makes (its `api/paymongo-webhook.js` does the same). `npm test` checks that call and that the seed has every code the website's choices depend on.
