# Dodo Payments

Dodo is set up alongside Lemon Squeezy, not instead of it. Lemon Squeezy keys
keep working exactly as before, and the buy buttons still point at Etsy for now.

## What is already done

- **Two products in Dodo test mode**, matching Lemon Squeezy:
  - Ultimate Budget Planner, $49.99, product `pdt_0NpX69EmC20ESFfJv1rBw`
  - Simple Budget Planner, $19.99, product `pdt_0NpX69MrqOl0s171bu7rM`

  Both are a one-time payment. Each issues a license key that works on up to 3
  devices. Dodo emails the key to the buyer with a link that opens the key
  prompt (`/budgetplanner?redeem=ubp` or `?redeem=sbp`).

- **The app accepts Dodo keys** (script.js, "Dodo Payments keys"):
  - A key is tried on Lemon Squeezy first, then on Dodo.
  - Dodo keys are case-sensitive, so they are checked exactly as typed.
  - Each device activates the key once, and re-entering it on the same browser
    does not use another device.
  - A 4th device gets the usual "already used on the maximum number of devices"
    message.

- **Daily re-check:**
  - If a key is refunded or disabled in Dodo, the planner locks again at its
    next daily check.
  - Being offline never locks anyone out.

- **The Apps Script records Dodo sales and alerts your phone** (Code.gs, `_handleDodoWebhook`). They
  go in the same Sales sheet with the same phone alerts, marked "(Dodo)".

- **The admin panel:**
  - Dodo orders appear in the Orders list.
  - Dodo keys show a "Dodo Payments" label.
  - Dodo keys are revoked in the Dodo dashboard. The app then locks them out at
    the next daily check.

## What you need to do

### 1. Update the Apps Script
1. Open the Apps Script project, replace Code.gs with the new one from the
   repo, and save.
2. In **Project Settings, Script Properties**, add `DODO_WEBHOOK_SECRET` with a
   long random value. Make one at random.org or with any password generator.
3. Optional: add `DODO_MODE` with the value `live` once you sell for real. It
   defaults to `test`.
4. Click **Deploy, Manage deployments**, edit the existing deployment, choose
   **New version**, and deploy. The web app URL stays the same.

### 2. Add the webhook in Dodo
1. In the Dodo dashboard, go to **Developer, Webhooks, Add endpoint**.
2. Set the URL to your Apps Script web app URL with the secret on the end:
   `https://script.google.com/macros/s/YOUR-DEPLOYMENT-ID/exec?dwh=YOUR-SECRET`
3. Choose the events `payment.succeeded` and `refund.succeeded`.

Apps Script cannot read Dodo's signature headers, so the secret in the URL is
what keeps strangers out, the same as with Lemon Squeezy. Keep the URL private.

### 3. Check your phone alert
Dodo sales use the same phone alerts as Lemon Squeezy: Pushover, Telegram, or
both, from the Script Properties you already set. Nothing new is needed.

In the Apps Script editor, choose **simulateDodoSale** and click **Run**. Your
phone should ring with "Cha-ching! Ultimate Budget Planner, $49.99 (Dodo)
[TEST]", and a row appears on the Sales sheet. If nothing arrives, run
**diagnoseChaChing** and read the Execution log.

### 4. Try a test purchase
1. Open the test checkout:
   `https://test.checkout.dodopayments.com/buy/pdt_0NpX69EmC20ESFfJv1rBw?quantity=1`
2. Pay with a test card from Dodo's testing page (docs.dodopayments.com,
   "Testing Process").
3. You should get the key by email, the sale should appear in the Sales sheet,
   and your phone should chirp. Paste the key at
   `/budgetplanner?redeem=ubp` and the full planner opens.

## Going live
1. Once Dodo approves your store, make the same two products in **live mode**,
   with license keys on and an activation limit of 3.
2. In script.js:
   - set `DODO_MODE = 'live'`;
   - put the live product ids in `DODO_PRODUCT_TOOL` and `DODO_CHECKOUT_URLS`;
   - when you are ready to sell through Dodo, point `PURCHASE_URLS` (in
     script.js and ultimate-budget.js) at the Dodo checkout links.
3. In Code.gs, put the live product ids in `DODO_PRODUCT_NAMES` and set the
   `DODO_MODE` Script Property to `live`. Then deploy a new version.
4. Point the Dodo webhook at the same URL in live mode.

Your Dodo API key is never needed in the app or the repo. The app only uses
Dodo's public license endpoints.
