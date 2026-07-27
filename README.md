
[GreasyFork Page](https://greasyfork.org/en/scripts/519037-nexus-no-wait) | [Direct Install (GreasyFork)](https://update.greasyfork.org/scripts/519037/Nexus%20No%20Wait%20%2B%2B.user.js) | [Direct Install (GitHub)](https://github.com/torkelicious/nexus-no-wait-pp/raw/refs/heads/main/NexusNoWaitPP.user.js)

---

# Nexus No Wait ++

A userscript for Nexus Mods that skips download countdowns, bypasses redirects, auto-downloads files, and adds quality-of-life features.

---

## Requirements

To run this script, you need a modern web browser and a userscript manager. 
* **Recommended Managers:** [Violentmonkey](https://violentmonkey.github.io/) or [Tampermonkey](https://www.tampermonkey.net/)
* **A Web browser:** Chrome, Firefox, Edge, Brave, Helium, etc.

> **Note:** First and foremost tested on **Helium browser** with **Violentmonkey**, and on **Firefox** for major releases.

---

## Features

- **Skip download countdowns:** Instantly start downloads without waiting out timers.
- **Universal support:** Works across Manual, Vortex, MO2, NMM, and `nxm://` links.
- **Auto-start direct downloads:** Optionally triggers downloads automatically for `file_id=` URLs (great for modlists).
- **Auto-close download tabs:** Optionally closes tabs a few seconds after a download begins.
- **Archived file downloads:** Re-adds working download buttons to archived mod file listings.
- **Error notifications:** Optionally alerts you with audio or popups if a download fails.
- **Skip requirements popups:** Automatically bypasses mod requirement dialogs and tabs.
- **Force Mod Manager buttons:** Adds a "Mod Manager Download" button to manual-only files.
- **Restore Mod ID to filenames:** Optionally appends Mod IDs back onto downloaded filenames for easier manual organization.
- **In-Page Configuration:** Configurable via the "Settings" menu added to your userscript manager while visiting Nexus Mods.


⚠ **Use at your own risk. This script may violate Nexus Mods' Terms of Service. While no bans have been reported, use caution and avoid excessive automated downloads to prevent getting rate-limited or flagged.**

---

## Annoyance / Upsell Blocker Filter List

> The built-in Upsell Blocker has been deprecated in favor of an adblock filter list.

* **[Click here to subscribe to the Filter List](https://subscribe.adblockplus.org/?location=https%3A%2F%2Fraw.githubusercontent.com%2Ftorkelicious%2Fnexus-no-wait-pp%2Fmain%2Ffilterlist.txt&title=Upsell%20Blocker)** 

* **Manual Install:** If the button above doesn't work for your specific adblocker, copy [this raw link](https://raw.githubusercontent.com/torkelicious/nexus-no-wait-pp/main/filterlist.txt) and paste it into your extension's custom filter lists settings.

---

## Troubleshooting

### Downloads are failing or won't start
* **Check your login:** Ensure you are actively logged into your Nexus Mods account.
* **Test baseline:** Temporarily disable the script. If downloads still fail natively, the issue is on Nexus's end.
* **Isolate conflicts:** Temporarily disable other browser extensions or scripts to check for conflicts.
* **Check permissions:** If your userscript manager prompts you to allow cross-origin connections to external servers, select **"Always Allow"**.  
* **Reinstall script:** Try a fresh install of the script.

### Getting blocked by Cloudflare / VPN issues
If downloads get stuck on *"Please Wait..."*, fail with generic network errors, or show a *"cloudflare-challenge"* screen, try enabling these settings in order:
1. **Download Request Method** → `Native Fetch (Experimental)`
2. If it is still failing, also try **VPN Mode (Fallback Redirect)**

*(Both settings can be enabled simultaneously, but try one at the time first).*

### Script is not running / Grayed out
* **Check your manager:** Use a modern manager like **Violentmonkey** or **Tampermonkey**. Outdated managers like Greasemonkey are unsupported.
* **Enable Developer Mode:** Turn on Developer Mode in your browser's extension settings page to allow local script execution.
* **Tampermonkey settings:** Ensure **Allow User Scripts** and **Allow access to file URLs** are enabled in Tampermonkey settings.
* **Restart:** Completely restart your browser after changing extension settings.

### Downloads work for `.zip`, but `.7z` files are blocked!
* **The Fix:** Open your **Tampermonkey Dashboard** and go to the **Settings** tab. Set "Config mode" to **Beginner** or **Advanced**. Scroll down to **Downloads BETA**, locate **Whitelisted File Extensions**, and manually add `.7z` to the list.

### Downloads aren't opening in my Mod Manager (Vortex/MO2)
* Check your browser's protocol handler settings. Ensure your browser isn't blocking `nxm://` links from launching external applications like Vortex or Mod Organizer 2.

### Speed is still slow
* This script bypasses site waiting timers, but it **does not** unlock Premium speeds. Additionally, Nexus Mods occasionally throttles accounts detected injecting scripts.

### Script stopped working today
* Nexus Mods frequently updates their front-end layout, which can temporarily break site selectors. Check your manager for script updates or open an issue on GitHub.

### Still having issues?

If nothing above fixes the problem:

* **[Open an issue on GitHub](https://github.com/torkelicious/nexus-no-wait-pp/issues)** (I am most active here).

* Or post a comment on the GreasyFork page.

*(When reporting an issue, please include your browser, userscript manager, and any error messages from your browser's console)*

>*Feature requests are also welcome.*
---

*Originally based on StrangeT's Nexus No Wait.*
