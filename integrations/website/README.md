# Website → dashboard (online bookings and pre-orders)

Ready but not switched on. The website (`WanderCafe-monset`) still runs on its own. When it moves to the dashboard's Supabase project:

- A paid **room booking** shows in Bookings as *Confirmed · Website*, with its 50% deposit recorded. Managers get a push notification.
- A paid **food pre-order** becomes a normal POS sale. It shows on the order board on the day it's wanted, as *Website*, with the pick-up time, phone and notes. It counts in Sales and Analytics, and the whole team gets a push.

The dashboard side is already done and tested:
- `supabase/schema.sql` section 12: the `orders` table, `record_web_order` and `confirm_web_booking`.
- `server/notify.js`: the push notifications.
- `dashboard.js` in this folder: the website's half of the work.

## Switching it on

1. **Database.** Point the website's `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` at the dashboard's project. Do **not** run the website's own `supabase/schema.sql` there, because the dashboard's schema already creates `bookings` and `orders`.
2. **Copy** `dashboard.js` to `WanderCafe-monset/api/_dashboard.js`.
3. **Website code:** three small edits.
   - `src/lib/order.js` › `checkOrder`: keep the picked choices on each line, as `lines.push({ ...d, qty: l.qty, choices: l.choices })`.
   - `api/checkout.js` › the order's `save`: store `items: lines.map((l) => orderLine({ id: l.item.id, label: l.label, unit: l.unit, qty: l.qty, picked: l.choices }))`.
   - `api/paymongo-webhook.js`: replace the `PATCH … status: "paid"` block with
     ```js
     const r = await recordPaid(db, kind, ref, session);
     if (!r.ok) return json({ error: "Could not record payment" }, 500); // PayMongo retries
     ```
4. **Website availability:** in `api/availability.js`, a booked room is now `confirmed`, not `paid`. Change `status.in.(paid,checked_in)` to `status.in.(confirmed,checked_in)`.
5. **Notifications:** in Supabase › Database › Webhooks, add two webhooks. Both are **Update** events, sent by HTTP POST to `https://dashboard.wanderbyfleur.com/api/notify` with the header `x-webhook-secret: <WEBHOOK_SECRET>`.
   - One on table `bookings`.
   - One on table `orders`.

   Delete the old *Insert* webhook on `bookings` if it exists.
6. **Test** with a PayMongo test payment:
   - Book a room. It should show as Confirmed · Website, and managers get a push.
   - Order a coffee for today. It should appear on the order board as Website.

## Things to know

- **Menu codes.** Each website menu item maps to a POS product code in `POS_CODE` (`dashboard.js`). A new item needs a line there *and* a product with that code in Inventory.
  - If an item has no code, the order still goes through, and its note says `NOT ON THE POS MENU`.
  - An order with no known items at all is refused, so PayMongo keeps retrying until someone fixes the code.
  - `npm test` checks that every code exists.
- **Prices.** The sale uses the POS price, while PayMongo charged the website's price. If they differ, the order note says `PAID ONLINE P… , POS PRICE P…`. Keep `menu.js` and Inventory prices in step.
- **Late payments and cancellations.**
  - If a guest pays after their 30-minute hold lapsed and someone else took the nights, the booking becomes *Conflict*. That means a refund is due.
  - A booking a manager cancelled stays cancelled, even if a late payment arrives.
- **Only the website's server key can call these functions.** Signed-in staff can't confirm a payment or create a web order.
