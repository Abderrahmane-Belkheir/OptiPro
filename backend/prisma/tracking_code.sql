-- Run ONCE on the database (as the owner role), BEFORE the servers and the apps that send the tracking code are deployed. Safe to run again.
--
-- The tracking code of an order: a random 6-digit number (100000 to 999999), different for every order of a shop, that the customer follows the order with:
-- GET /api/orders/<tracking code> (public; the shop is the request's host). The desktop app makes it when an order is placed and sends it with the order.
--
-- Deploy in this order:
--   1. this file on Neon;  2. the Worker (cloudflare/dist) and the Express backend;  3. the desktop app.
-- (An app that sends the code to a server that does not have the column yet is refused for "trackingCode is not a column of orders", and the order stays unsent.)

ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_code integer;

-- different for every order of a shop; any number of orders may have none (older orders)
CREATE UNIQUE INDEX IF NOT EXISTS orders_tenant_key_tracking_code_key ON orders (tenant_key, tracking_code);
