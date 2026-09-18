# Cha-ching: getting a sale to ring your phone

Lemon Squeezy tells your Apps Script whenever something is bought. The
script records the order and sends you a Telegram message. Your phone plays
the cash-register sound because the bot's chat is given its own
notification tone.

Test-mode sales ring too and are marked `[TEST]`, which is how you prove
the whole chain works before going live.

The notification looks like this:

```
💰 Cha-ching!
Ultimate Budget Planner
```

A refund arrives as `↩️ Refund` with the same product name, so the two are
easy to tell apart.

The amount, the variant and the buyer's email are not in the notification.
They are all recorded on the **Sales** sheet and shown in the admin panel's
**Emails** tab, so nothing is lost.

---

## Step 1: make the bot

1. In Telegram, search for **@BotFather** and open the chat.
2. Send `/newbot`. It asks for a display name, then a username ending in
   `bot`, for example `EzzoSalesBot`.
3. It replies with a **token** that looks like
   `8123456789:AAH1a2B3c4D5e6F7g8H9i0J1k2L3m4N5o6P`. Copy it.
4. **Open a chat with your new bot and send it any message**, for example
   `hi`. A bot cannot message you first, so skipping this means you will
   never receive anything.

## Step 2: find your chat id

Open this in any browser, with your token pasted in place of `<TOKEN>`:

```
https://api.telegram.org/bot<TOKEN>/getUpdates
```

Look for `"chat":{"id":123456789,` in the response. That number is your
chat id. If the response is `{"ok":true,"result":[]}`, you skipped sending
the bot a message in step 1.

## Step 3: put the values into Apps Script

Open the Apps Script project, click the gear for **Project Settings**,
scroll to **Script Properties**, and add three:

| Property | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | the token from step 1 |
| `TELEGRAM_CHAT_ID` | the number from step 2 |
| `LS_WEBHOOK_SECRET` | any long random string you invent |

For the secret, something like `whk_8fJ2nQ4vX7pL3mZ`. Only Lemon Squeezy
and your script ever see it. Without it every webhook is ignored.

**Then redeploy**: Deploy → Manage deployments → edit the active
deployment → Version: New version → Deploy.

## Step 4: prove your phone rings, before involving Lemon Squeezy

In the Apps Script editor, pick **`testChaChing`** from the function
dropdown and press **Run**.

A Telegram message should arrive within a few seconds. If it does not, the
problem is in the three properties above, and it is much easier to fix here
than after adding a webhook.

## Step 5: set the cash-register sound

Your file is already the right shape for this: **2.81 seconds, 55KB**.
Telegram on iOS requires under 5 seconds and under 300KB, so it needs no
trimming.

```
C:\Users\brayd\Downloads\freesound_community-cash-register-purchase-87313.mp3
```

**Get the file onto your phone first.** Email it to yourself, put it in
Google Drive, or send it to yourself in Telegram's Saved Messages and
download it there.

**On Android:**

1. Open the chat with your bot.
2. Tap the bot's name at the top to open its profile.
3. Tap **Notifications**, then **Sound**.
4. Choose your file. Telegram lets you browse the device for it, and some
   versions need the file in the phone's `Notifications` folder first.

**On iPhone:**

1. In Telegram, open **Settings → Notifications and Sounds**.
2. Under **Notification Tones**, tap **Upload Sound** and pick the file.
3. Open the chat with your bot, tap its name, then **Sound**, and select
   the tone you just uploaded.

Setting the tone on the bot's chat specifically means only sales make that
noise. Everything else in Telegram keeps its normal sound.

## Step 6: point Lemon Squeezy at the script

In Lemon Squeezy: **Settings → Webhooks → Add endpoint**.

**Callback URL**, with your own secret on the end:

```
https://script.google.com/macros/s/AKfycbzill8JQ1BwGzjBMmVm8ucbco-lF1ouvZr6KmDe_CyfloJCzy69Xi-ZSheARQtR0InO/exec?wh=YOUR_SECRET_HERE
```

**Signing secret**: put the same `LS_WEBHOOK_SECRET` value there. Lemon
Squeezy requires the field. See the note at the end about why the script
cannot actually use it.

**Events**: tick `order_created`, and `order_refunded` as well if you want
to hear about those.

Save, then make a test purchase through your own checkout link. Test mode
charges nothing, and the message arrives marked `[TEST]`.

---

## Two things worth knowing

**Repeat deliveries are ignored.** Lemon Squeezy retries any webhook it
thinks failed. The script checks whether it has already seen that order and
event, so a sale rings once rather than three times.

**The secret is in the URL rather than a verified signature.** Lemon
Squeezy signs each webhook with an HMAC in the `X-Signature` header, which
is the proper way to check it came from them. Apps Script's `doPost` cannot
read request headers at all, so that signature is unavailable to us. The
shared secret in the query string is the workaround.

It is weaker: anyone who learned the full URL including the secret could
make your phone show a sale that did not happen. They could not touch
money, data, or anything else. Keep the URL private, and if you ever think
it has leaked, change `LS_WEBHOOK_SECRET` in Script Properties and update
the endpoint in Lemon Squeezy to match.

---

## If you ever want Pushover instead

The code still supports it, and it has a cash-register tone built in with
no file handling at all. Add `PUSHOVER_TOKEN` and `PUSHOVER_USER` to Script
Properties and it will send to both. Roughly $5 once per platform.
