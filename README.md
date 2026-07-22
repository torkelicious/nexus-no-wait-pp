Github host for Nexus No Wait ++

[GreasyFork page](https://greasyfork.org/en/scripts/519037-nexus-no-wait)

Install using your preferred userscript manager (such as Violentmonkey or Tampermonkey).

- [Direct install (GreasyFork)](https://update.greasyfork.org/scripts/519037/Nexus%20No%20Wait%20%2B%2B.user.js)
- [Direct install (GitHub)](https://github.com/torkelicious/nexus-no-wait-pp/raw/refs/heads/main/NexusNoWaitPP.user.js)

---

# Nexus No Wait ++
A userscript for Nexus Mods that skips countdowns, bypasses redirects, auto-downloads files, and other extra features

### Requirements
To use this, you need a web browser (Chrome, Firefox, Edge, etc.) and a userscript manager. I recommend **Violentmonkey** or **Tampermonkey**.
>*This script is first and foremost tested on Helium browser with Violentmonkey, Firefox too when there are major updates*

## Features

- **Skip download countdowns:** Instantly start downloads without waiting.
- **Supports all games and mod managers:** Works with Manual, Vortex, MO2, NMM, and nxm links.
- **Auto-start downloads for `file_id=` URLs:** Optionally triggers downloads automatically for direct file links (great for modlists).
- **Auto-close tab after download starts:** Optionally closes the tab a few seconds after the download begins.
- **Download buttons for archived files:** Adds working download buttons to archived file listings.
- **Error notifications:** Optionally alerts you with a popup and/or sound if a download fails.
- **Skip requirements popups/tabs:** Optionally bypasses mod requirements dialogs and tabs.
- **Force-add Mod Manager buttons:** Adds a mod manager download button to manual-only files.
- **Restore Mod ID to filenames:** Optionally appends the Mod ID back onto filenames for easier manual organization.
- **Hide premium upsells:** Optionally hides premium banners and other annoyances (experimental).
- **UI for configuration:** Access via the "Settings" button added to the userscript manager menu while on a Nexus Mods page.

---

⚠ **This script may violate Nexus Mods' Terms of Service. Use at your own risk.**  
No bans have been reported, but use caution and avoid excessive automated downloads to avoid getting rate-limited.

---

## Troubleshooting

### Downloads are failing or won't start

* **Check your login:** Make sure you are actively logged into your Nexus Mods account.
* **Test the baseline:** Temporarily disable the script. If the download still fails natively, the issue is on Nexus's end.
* **Isolate conflicts:** Temporarily disable other browser extensions or userscripts to ensure they aren't interfering with the downloads.
* **Check permissions:** If your userscript manager prompts you to allow connections to external servers, make sure to click "Always Allow".
  > *(Yes, I know it sounds sketchy, but read the code yourself, it's required.)*

### Getting blocked by Cloudflare / VPN issues

Downloads stuck on *"Please Wait..."*, failing with a generic network error, or showing a *"cloudflare-challenge"* error? Try these in Settings, in order:

1. **Download Request Method → Native Fetch (Experimental)**
2. If it is Still failing? Also enable **VPN Mode (Fallback Redirect)**

Both can be on at once. Still stuck after both? Please report it (see below).

### Script is not running / Grayed out

* **Check your manager:** Ensure you are using a modern userscript manager like **Violentmonkey** or **Tampermonkey**. Outdated ones like Greasemonkey are not supported and may cause issues.
* **Enable Developer Mode:** Go to your browser’s extension settings and toggle on Developer Mode to allow the script to activate.
* **Tampermonkey specific settings:** If using Tampermonkey, go to its extension settings and ensure **Allow User Scripts** and **Allow access to file URLs** are enabled.
* **Restart:** Completely close and restart your browser after making any of these changes.

### Downloads work for .zip but .7z files are blocked!

* **Check Tampermonkey Settings:** Tampermonkey has a built-in security whitelist for the download manager. Sometimes, `.7z` is not allowed by default.
* **The Fix:** Open your Tampermonkey Dashboard and go to the **Settings** tab. Ensure "Config mode" is set to at least **Beginner** or **Advanced**. Scroll down to the **Downloads BETA** section, find **Whitelisted File Extensions**, and make sure `.7z` is added to that list.

### Downloads aren't going to my Mod Manager (Vortex/MO2)

* **Check browser handlers:** If nothing happens when you click "Mod Manager Download," your browser is likely blocking `nxm://` links from opening external apps. Make sure your browser is set to allow Nexus to open Vortex or Mod Organizer 2.

### My download speed is still slow!

* This script **does not** give you free Premium, even though sometimes it may seem so. I also cannot prevent Nexus Mods from detecting script injections as an adblocker and capping your speeds.

### It was working fine, but broke today

* **Check for script updates:** Nexus Mods occasionally updates their website layout, which can temporarily break userscripts. Check your userscript manager to ensure you have updated to the latest version of Nexus No Wait ++. Otherwise, open an issue and I'll look into it.

### Still having issues?

If nothing above fixes the problem:

* **[Open an issue on GitHub](https://github.com/torkelicious/nexus-no-wait-pp/issues)** (I am most active here).
* Or post a comment on the GreasyFork page.

*(When reporting an issue, please include your browser, userscript manager, and any error messages from your browser's console)*

>*Feature requests are also welcome.*

---

**Originally based on StrangeT's Nexus No Wait**
