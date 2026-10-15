# Set up sync with your Google Sheet

You do this once. Afterwards every device stays in step through your own Google Sheet,
at no cost.

**You need:** a computer with Chrome, signed in to the Google account that should keep the
budget. Use a personal account, not a work one. Use a Chrome profile signed in to **only**
that account: with several accounts in one window, Apps Script can open the wrong one.

## 1. Create the Sheet

Go to **sheets.new** and name the Sheet, for example *Household Budget Sync*.

## 2. Add the sync script

1. In the Sheet: **Extensions → Apps Script**.
2. Click the project name at the top left and rename it **Budget Sync**.
3. Delete everything in `Code.gs`. Then paste the whole of
   [`apps-script/Code.gs`](../apps-script/Code.gs) from this repository (on GitHub, use
   **Copy raw file**).
4. Save (Ctrl+S).

## 3. Run setup

1. In the toolbar's function list choose **setup**, then click **Run**.
2. Google asks for permission:
   1. Click **Review permissions** and choose your account.
   2. You'll see *"Google hasn't verified this app"*. Click **Advanced → Go to Budget Sync (unsafe)**, then **Allow**.

   It is your own script, and it only works with this Sheet.
3. The Execution log shows **`Sync code: …`**. Keep it private: it is the key to your budget.

## 4. Deploy it as a web app

1. **Deploy → New deployment**, click the gear icon, and choose **Web app**.
2. **Execute as: Me**. **Who has access: Anyone**.
3. Click **Deploy** (approve again if asked), then copy the **Web app URL**. It ends with `/exec`.
4. Optional check: open that URL in a new tab. It should show
   `{"ok":true,"app":"budget-sync","protocol":1}`.

## 5. Connect the first device

1. Open the app. On the first setup screen choose **Connect to it first**, or go to **Settings → Sync → Connect**.
2. Paste the web app link and the sync code, then click **Connect**.
3. Finish the setup. Everything you enter is saved to the Sheet.

## 6. Add your other devices

1. On the connected device: **Settings → Connect another device**. A QR code appears.
2. On the other phone or tablet:
   1. Scan the QR code with the camera and open the link in **Chrome**.
   2. Enter a name and click **Connect this device**.
   3. Install the app: **⋮ → Install app**.

## Good to know

- **"Who has access: Anyone"** means anyone with the link can *reach* the script. Every request
  must carry the sync code; without it the script refuses before touching the Sheet.
- **Your Sheet stays private.** Share it only with people who should see the budget.
- **Read the "Expenses" tab** for a readable list. The "Records" tab is the app's own data:
  don't edit it by hand.
- **Code lost or shared by mistake:** in the Sheet, use **Budget sync → Make a new sync code**
  (reload the Sheet if the menu is missing). Then reconnect each device with the new code.
- **Updating the script later:**
  1. Paste the new `Code.gs` and Save.
  2. **Deploy → Manage deployments**, click the pencil, set **Version: New version**, and click **Deploy**.

  Don't use *New deployment* for this: it creates a new link and every device would have to reconnect.
- **Offline:** entries made without internet wait on the device and sync when it's back
  online, as soon as the app is open.
