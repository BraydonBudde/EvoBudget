# Cha-ching: getting a sale to ring your phone

Lemon Squeezy tells your Apps Script whenever something is bought. The
script records the order and pushes a notification to your phone. Test-mode
sales ring too, and say so, which is how you test the whole chain before
going live.

Nothing here costs anything if you pick Telegram. Pushover is a one-off
purchase but has an actual cash-register sound built in.

---

## Step 1: pick how the phone gets told

You can set up either, or both. Both is useful if you want a loud one and a
quiet one.

### Option A: Pushover (has a real "cha-ching")

Roughly $5 once per platform, no subscription.

1. Sign up at **pushover.net** and install their app on your phone.
2. Your **User Key** is on the dashboard the moment you log in.
3. Under "Your Applications", click **Create an Application**, name it
   anything, and copy the **API Token** it gives you.

The sound is already set to Pushover's built-in `cashregister`, so it
sounds like a till without you configuring anything.

### Option B: Telegram (free)

1. In Telegram, message **@BotFather**, send `/newbot`, follow the prompts,
   and copy the **token** it gives you.
2. Message your new bot once, anything at all, so it is allowed to message
   you back.
3. Open this in a browser, with your token in place:
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
   Find `"chat":{"id":123456789` in the response. That number is your
   **chat id**.
4. On your phone, open the chat with the bot, then its settings, and set a
   **custom notification sound**. That is where the cha-ching comes from.

---

## Step 2: put the values into Apps Script

Open the Apps Script project, then **Project Settings** (the gear on the
left), scroll to **Script Properties**, and add whichever apply:

| Property | Value |
|---|---|
| `LS_WEBHOOK_SECRET` | any long random string you invent |
| `PUSHOVER_TOKEN` | the API token from step 1A |
| `PUSHOVER_USER` | your user key from step 1A |
| `TELEGRAM_BOT_TOKEN` | the bot token from step 1B |
| `TELEGRAM_CHAT_ID` | the chat id from step 1B |

`LS_WEBHOOK_SECRET` is required. Without it every webhook is ignored.
Invent something long, for example `whk_8fJ2nQ4vX7pL3mZ` — it is only ever
seen by Lemon Squeezy and your script.

**Then redeploy**: Deploy → Manage deployments → edit → New version →
Deploy.

---

## Step 3: check your phone rings, before any sale

In the Apps Script editor, choose **`testChaChing`** from the function
dropdown and press **Run**.

Your phone should buzz within a few seconds. If it does not, the problem is
in the Script Properties, not in Lemon Squeezy, and it is worth fixing here
before going further.

---

## Step 4: point Lemon Squeezy at the script

In Lemon Squeezy: **Settings → Webhooks → Add endpoint**.

**Callback URL** is your web app URL with the secret on the end:

```
https://script.google.com/macros/s/AKfycbzill8JQ1BwGzjBMmVm8ucbco-lF1ouvZr6KmDe_CyfloJCzy69Xi-ZSheARQtR0InO/exec?wh=YOUR_SECRET_HERE
```

**Signing secret**: put your `LS_WEBHOOK_SECRET` there too. Lemon Squeezy
requires the field. See the note at the bottom about why the script does
not use it.

**Events**: tick `order_created`. Tick `order_refunded` too if you want to
hear about those, which is worth it.

Save, then make a test purchase through your own checkout link. Test mode
does not charge anything, and the notification will arrive marked
`[TEST MODE]`.

---

## What you get

A sale:

```
💰 Cha-ching!
$49.99 — Ultimate Budget Planner (Dark / Classic)
buyer@example.com
```

A refund arrives as `↩️ Refund`, with a different sound so you can tell
them apart without looking.

Every order is also written to a **Sales** sheet, and the buyers show up in
the admin panel's **Emails** tab. That closes a gap from the audit: the
sales report returns totals only, so before this a Lemon Squeezy buyer's
address never reached your email list.

---

## Two things worth knowing

**Repeat deliveries are ignored.** Lemon Squeezy retries a webhook it
thinks failed. The script checks whether it has already seen that order and
event, so your phone rings once per sale rather than three times.

**The secret is in the URL rather than a signature.** Lemon Squeezy signs
each webhook with an HMAC in the `X-Signature` header, which is the proper
way to verify it. Apps Script's `doPost` cannot read request headers at
all, so that signature is unavailable to us. The shared secret in the query
string is the workaround.

It is weaker: anyone who learned the full URL including the secret could
make your phone show a fake sale. They could not touch money, data, or
anything else, so the trade is worth it. Keep the URL private, and if you
ever suspect it has leaked, change `LS_WEBHOOK_SECRET` and update the
endpoint in Lemon Squeezy.
