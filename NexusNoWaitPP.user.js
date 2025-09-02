// ==UserScript==
// @name        Nexus No Wait ++
// @description Download from Nexusmods.com without wait and redirect (Manual/Vortex/MO2/NMM), Tweaked with extra features.
// @namespace   NexusNoWaitPlusPlus
// @author      Torkelicious
// @version     1.1.9
// @include     https://*.nexusmods.com/*
// @run-at      document-idle
// @iconURL     https://raw.githubusercontent.com/torkelicious/nexus-no-wait-pp/refs/heads/main/icon.png
// @icon        https://raw.githubusercontent.com/torkelicious/nexus-no-wait-pp/refs/heads/main/icon.png
// @grant       GM_xmlhttpRequest
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_deleteValue
// @license     GPL-3.0-or-later
// @downloadURL https://update.greasyfork.org/scripts/519037/Nexus%20No%20Wait%20%2B%2B.user.js
// @updateURL https://update.greasyfork.org/scripts/519037/Nexus%20No%20Wait%20%2B%2B.meta.js
// ==/UserScript==

/* global GM_getValue, GM_setValue, GM_deleteValue, GM_xmlhttpRequest, GM_info GM */

(function () {
  const DEFAULT_CONFIG = {
    autoCloseTab: true, // Close tab after download starts
    skipRequirements: true, // Skip requirements popup/tab
    showAlerts: true, // Show errors as browser alerts
    refreshOnError: false, // Refresh page on error
    requestTimeout: 30000, // Request timeout (30 sec)
    closeTabTime: 1000, // Wait before closing tab (1 sec)
    debug: false, // Show debug messages as alerts
    playErrorSound: true, // Play a sound on error
  };

  // === Settings Management ===
  function validateSettings(settings) {
    if (!settings || typeof settings !== "object") return { ...DEFAULT_CONFIG };

    const validated = { ...settings }; // Keep all existing settings

    for (const [key, defaultValue] of Object.entries(DEFAULT_CONFIG)) {
      if (typeof validated[key] !== typeof defaultValue) {
        validated[key] = defaultValue;
      }
    }

    return validated;
  }

  function loadSettings() {
    try {
      const saved = GM_getValue("nexusNoWaitConfig", null);
      const parsed = saved ? JSON.parse(saved) : DEFAULT_CONFIG;
      return validateSettings(parsed);
    } catch (error) {
      console.warn("GM storage load failed:", error);
      return { ...DEFAULT_CONFIG };
    }
  }

  function saveSettings(settings) {
    try {
      GM_setValue("nexusNoWaitConfig", JSON.stringify(settings));
      logMessage("Settings saved to GM storage", false, true);
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  }
  const config = Object.assign({}, DEFAULT_CONFIG, loadSettings());

  // Global sound instance
  const errorSound = new Audio(
    "https://github.com/torkelicious/nexus-no-wait-pp/raw/refs/heads/main/errorsound.mp3"
  );
  errorSound.load(); // Preload sound

  // Plays error sound if enabled
  function playErrorSound() {
    if (!config.playErrorSound) return;
    errorSound.play().catch((e) => {
      console.warn("Error playing sound:", e);
    });
  }

  // === Error Handling ===
  function logMessage(message, showAlert = false, isDebug = false) {
    if (isDebug) {
      console.log(
        "[Nexus No Wait ++]: " + message + "\nPage:" + window.location.href
      );
      if (config.debug) {
        alert("[Nexus No Wait ++] (Debug):\n" + message);
      }
      return;
    }

    playErrorSound(); // Play sound before alert
    console.error(
      "[Nexus No Wait ++]: " + message + "\nPage:" + window.location.href
    );
    if (showAlert && config.showAlerts) {
      alert("[Nexus No Wait ++] \n" + message);
    }

    if (config.refreshOnError) {
      location.reload();
    }
  }

  // === URL and Navigation Handling ===
  if (
    window.location.href.includes("tab=requirements") &&
    config.skipRequirements
  ) {
    const newUrl = window.location.href.replace(
      "tab=requirements",
      "tab=files"
    );
    window.location.replace(newUrl);
    return;
  }

  // === AJAX Setup and Configuration ===
  let ajaxRequestRaw;
  if (typeof GM_xmlhttpRequest !== "undefined") {
    ajaxRequestRaw = GM_xmlhttpRequest;
  } else if (
    typeof GM !== "undefined" &&
    typeof GM.xmlHttpRequest !== "undefined"
  ) {
    ajaxRequestRaw = GM.xmlHttpRequest;
  }

  // Wrapper for AJAX requests
  function ajaxRequest(obj) {
    if (!ajaxRequestRaw) {
      logMessage(
        "AJAX functionality not available (Your browser or userscript manager may not support these requests!)",
        true
      );
      return;
    }
    ajaxRequestRaw({
      method: obj.type,
      url: obj.url,
      data: obj.data,
      headers: obj.headers,
      timeout: config.requestTimeout,
      onload: function (response) {
        if (response.status >= 200 && response.status < 300) {
          obj.success(response.responseText);
        } else {
          obj.error(response);
        }
      },
      onerror: function (response) {
        obj.error(response);
      },
      ontimeout: function (response) {
        obj.error(response);
      },
    });
  }

  // === Button Management ===
  function btnError(button, error) {
    try {
      if (button && button.style) button.style.color = "red";
      let errorMessage = "Download failed: ";
      if (error) {
        if (typeof error === "string") {
          errorMessage += error;
        } else if (error.message) {
          errorMessage += error.message;
        } else if (error.status) {
          errorMessage += `HTTP ${error.status} ${error.statusText || ""}`;
        } else if (typeof error.responseText === "string") {
          errorMessage += error.responseText;
        } else {
          errorMessage += JSON.stringify(error);
        }
      } else {
        errorMessage += "Unknown error";
      }
      if (button && "innerText" in button) {
        button.innerText = "ERROR: " + errorMessage;
      }
      logMessage(errorMessage, true);
    } catch (e) {
      logMessage(
        "Unknown error while handling button error: " + e.message,
        true
      );
    }
  }

  function btnSuccess(button) {
    if (button && button.style) button.style.color = "green";
    if (button && "innerText" in button) {
      button.innerText = "Downloading!";
    }
    logMessage("Download started.", false, true);
  }

  function btnWait(button) {
    if (button && button.style) button.style.color = "yellow";
    if (button && "innerText" in button) {
      button.innerText = "Wait...";
    }
    logMessage("Loading...", false, true);
  }

  // Closes tab after download starts (if enabled)
  function closeOnDL() {
    if (config.autoCloseTab && !isArchiveDownload) {
      setTimeout(() => window.close(), config.closeTabTime);
    }
  }

  // fix download buttons in the action bar
  // determine a primary/selected file_id from the action bar or page
  function getPrimaryFileId() {
    try {
      // Prefer the Vortex action button in the header action bar
      const vortexAction = document.querySelector(
        '#action-nmm a[href*="file_id="]'
      );
      if (vortexAction) {
        const fid = new URL(vortexAction.href, location.href).searchParams.get(
          "file_id"
        );
        if (fid) return fid;
      }

      // Fallback to visible download link with file_id on page
      const anyFileLink = document.querySelector('a[href*="file_id="]');
      if (anyFileLink) {
        const fid = new URL(anyFileLink.href, location.href).searchParams.get(
          "file_id"
        );
        if (fid) return fid;
      }

      // Fallback to data-id on file headers (common on Files tab)
      const header = document.querySelector(".file-expander-header[data-id]");
      if (header) {
        const fid = header.getAttribute("data-id");
        if (fid) return fid;
      }
    } catch (e) {
      // ignore & return null
    }
    return null;
  }
  function isManualActionButton(el) {
    try {
      if (!el || !(el instanceof HTMLElement)) return false;
      if (el.classList && el.classList.contains("download-open-tab"))
        return true; 
      const li = el.closest("li");
      if (li && li.id === "action-manual") return true; 
      return false;
    } catch {
      return false;
    }
  }

  // === Download Handling ===
  function clickListener(event) {
    // Skip if this is an archive download
    if (isArchiveDownload) {
      isArchiveDownload = false; // Reset the flag
      return;
    }

    const selfIsElement = this && this.tagName;
    const href = (selfIsElement && this.href) || window.location.href;
    const params = new URL(href, location.href).searchParams;

    // Treat manual action bar button as a direct download button
    if (selfIsElement && isManualActionButton(this)) {
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      let button = this;
      btnWait(button);
      const section = document.getElementById("section");
      const gameId = section ? section.dataset.gameId : this.current_game_id;

      let fileId = getPrimaryFileId();
      if (!fileId) {
        btnError(button, {
          message:
            "Could not determine file ID for download (no link or file list found).",
        });
        return;
      }
      ajaxRequest({
        type: "POST",
        url: "/Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl",
        data:
          "fid=" +
          encodeURIComponent(fileId) +
          "&game_id=" +
          encodeURIComponent(gameId || ""),
        headers: {
          Origin: "https://www.nexusmods.com",
          Referer: href,
          "Sec-Fetch-Site": "same-origin",
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        success(data) {
          console.log("Nexus No Wait ++ [POST] raw response (preview):", String(data).slice(0, 1200));
          if (!data) {
            btnError(button, { message: "Empty response from server" });
            return;
          }

          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            parsed = null;
          }

          if (parsed && parsed.url) {
            btnSuccess(button);
            document.location.href = parsed.url;
            closeOnDL();
            return;
          }

          // Fallback looking for nxm:// or https? link in the response body
          const text = String(data);
          const nxmMatch = text.match(/(nxm:\/\/[^\s"'<>]+)/i);
          if (nxmMatch) {
            btnSuccess(button);
            document.location.href = nxmMatch[1];
            closeOnDL();
            return;
          }
          const httpMatch = text.match(/\bhttps?:\/\/[^\s"'<>]+/i);
          if (httpMatch) {
            btnSuccess(button);
            document.location.href = httpMatch[0];
            closeOnDL();
            return;
          }

          btnError(button, { message: "Could not extract download URL from server response." });
        },
        error(xhr) {
          btnError(button, xhr);
        },
      });

      return;
    }
    if (params.get("file_id")) {
      let button = event;
      if (selfIsElement && this.href) {
        button = this;
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
      }
      btnWait(button);

      const section = document.getElementById("section");
      const gameId = section ? section.dataset.gameId : this.current_game_id;

      let fileId = params.get("file_id");
      if (!fileId) {
        fileId = params.get("id");
      }
      const ajaxOptions = {
        type: "POST",
        url: "/Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl",
        data: "fid=" + fileId + "&game_id=" + gameId,
        headers: {
          Origin: "https://www.nexusmods.com",
          Referer: href,
          "Sec-Fetch-Site": "same-origin",
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        success(data) {
          console.log("NNW++ [POST] raw response (preview):", String(data).slice(0, 1200));
          if (!data) {
            btnError(button, { message: "Empty response from server" });
            return;
          }

          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            parsed = null;
          }

          if (parsed && parsed.url) {
            btnSuccess(button);
            document.location.href = parsed.url;
            closeOnDL();
            return;
          }

          // Fallbacks
          const text = String(data);
          const nxmMatch = text.match(/(nxm:\/\/[^\s"'<>]+)/i);
          if (nxmMatch) {
            btnSuccess(button);
            document.location.href = nxmMatch[1];
            closeOnDL();
            return;
          }
          const httpMatch = text.match(/\bhttps?:\/\/[^\s"'<>]+/i);
          if (httpMatch) {
            btnSuccess(button);
            document.location.href = httpMatch[0];
            closeOnDL();
            return;
          }

          btnError(button, { message: "No download URL returned from server" });
        },
        error(xhr) {
          btnError(button, xhr);
        },
      };

      if (!params.get("nmm")) {
        ajaxRequest(ajaxOptions);
      } else {
        // extract the slowDownloadButton data-download-url
        ajaxRequest({
          type: "GET",
          url: href,
          headers: {
            Origin: "https://www.nexusmods.com",
            Referer: document.location.href,
            "Sec-Fetch-Site": "same-origin",
            "X-Requested-With": "XMLHttpRequest",
          },
          success(data) {
            console.log("NNW++ [nmm GET] raw response (preview):", String(data).slice(0, 1200));
            if (!data) {
              btnError(button, { message: "Empty response from server" });
              return;
            }

            try {
              const doc = new DOMParser().parseFromString(data, "text/html");
              const slow = doc.getElementById("slowDownloadButton");
              if (slow) {
                const downloadUrl = slow.getAttribute("data-download-url") || slow.dataset?.downloadUrl;
                if (downloadUrl) {
                  btnSuccess(button);
                  document.location.href = downloadUrl;
                  closeOnDL();
                  return;
                }
              }

              // fallback to JSON.parse or link extraction before handing it back to the page
              let parsed = null;
              try {
                parsed = JSON.parse(data);
              } catch (_) {
                parsed = null;
              }
              if (parsed && parsed.url) {
                btnSuccess(button);
                document.location.href = parsed.url;
                closeOnDL();
                return;
              }
              const text = String(data);
              const nxmMatch = text.match(/(nxm:\/\/[^\s"'<>]+)/i);
              if (nxmMatch) {
                btnSuccess(button);
                document.location.href = nxmMatch[1];
                closeOnDL();
                return;
              }

              // let the site handle the link (open mod manager)
              btnSuccess(button);
              window.location.href = href;
            } catch (e) {
              btnError(button, e);
            }
          },
          error(xhr) {
            btnError(button, xhr);
          },
        });
      }

      const popup = selfIsElement ? this.parentNode : null;
      if (popup && popup.classList.contains("popup")) {
        popup.getElementsByTagName("button")[0]?.click();
        const popupButton = document.getElementById("popup" + fileId);
        if (popupButton) {
          btnSuccess(popupButton);
          closeOnDL();
        }
      }
    } else if (/ModRequirementsPopUp/.test(href)) {
      const fileId = params.get("id");

      if (fileId && selfIsElement) {
        this.setAttribute("id", "popup" + fileId);
      }
    }
  }

  // === Event Listeners  ===
  function addClickListener(el) {
    el.addEventListener("click", clickListener, true);
  }

  function addClickListeners(els) {
    for (let i = 0; i < els.length; i++) {
      addClickListener(els[i]);
    }
  }

  // === Automatic Downloading ===
  function autoStartFileLink() {
    if (/file_id=/.test(window.location.href)) {
      clickListener(document.getElementById("slowDownloadButton"));
    }
  }

  // Automatically skips file requirements popup and downloads
  function autoClickRequiredFileDownload() {
    const observer = new MutationObserver(() => {
      const downloadButton = document.querySelector(
        ".popup-mod-requirements a.btn"
      );
      if (downloadButton) {
        downloadButton.click();
        const popup = document.querySelector(".popup-mod-requirements");
        if (!popup) {
          logMessage("Popup closed", false, true);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });
  }

  // === Archived Files Handling ===
  const ICON_PATHS = {
    nmm: "https://www.nexusmods.com/assets/images/icons/icons.svg#icon-nmm",
    manual:
      "https://www.nexusmods.com/assets/images/icons/icons.svg#icon-manual",
  };

  let isArchiveDownload = false;

  function archivedFile() {
    try {
      // Only run in the archived category
      if (!window.location.href.includes("category=archived")) {
        return;
      }

      // DOM queries and paths
      const path = `${location.protocol}//${location.host}${location.pathname}`;
      const downloadTemplate = (fileId) => `
    <li>
        <a class="btn inline-flex"
           href="${path}?tab=files&file_id=${fileId}&nmm=1"
           data-fileid="${fileId}"
           data-manager="true"
           tabindex="0">
            <svg title="" class="icon icon-nmm">
                <use xlink:href="${ICON_PATHS.nmm}"></use>
            </svg>
            <span class="flex-label">Vortex</span>
        </a>
    </li>
    <li>
        <a class="btn inline-flex"
           href="${path}?tab=files&file_id=${fileId}"
           data-fileid="${fileId}"
           data-manager="false"
           tabindex="0">
            <svg title="" class="icon icon-manual">
                <use xlink:href="${ICON_PATHS.manual}"></use>
            </svg>
            <span class="flex-label">Manual</span>
        </a>
    </li>`;

      const downloadSections = Array.from(
        document.querySelectorAll(".accordion-downloads")
      );
      const fileHeaders = Array.from(
        document.querySelectorAll(".file-expander-header")
      );

      downloadSections.forEach((section, index) => {
        const fileId = fileHeaders[index]?.getAttribute("data-id");
        if (fileId) {
          section.innerHTML = downloadTemplate(fileId);
          const buttons = section.querySelectorAll("a.btn");
          buttons.forEach((btn) => {
            btn.addEventListener("click", function (e) {
              e.preventDefault();
              isArchiveDownload = true;
              // Use existing download logic
              clickListener.call(this, e);
              setTimeout(() => (isArchiveDownload = false), 100);
            });
          });
        }
      });
    } catch (error) {
      logMessage("Error with archived file: " + error.message, true);
      console.error("Archived file error:", error);
    }
  }

  // --------------------------------------------- === UI === --------------------------------------------- //

  const SETTING_UI = {
    autoCloseTab: {
      name: "Auto-Close tab on download",
      description: "Automatically close tab after download starts",
    },
    skipRequirements: {
      name: "Skip Requirements Popup/Tab",
      description: "Skip requirements page and go straight to download",
    },
    showAlerts: {
      name: "Show Error Alert messages",
      description: "Show error messages as browser alerts",
    },
    refreshOnError: {
      name: "Refresh page on error",
      description:
        "Refresh the page when errors occur (may lead to infinite refresh loop!)",
    },
    requestTimeout: {
      name: "Request Timeout",
      description: "Time to wait for server response before timeout",
    },
    closeTabTime: {
      name: "Auto-Close tab Delay",
      description:
        "Delay before closing tab after download starts (Setting this too low may prevent download from starting!)",
    },
    debug: {
      name: "⚠️ Debug Alerts",
      description:
        "Show all console logs as alerts, don't enable unless you know what you are doing!",
    },
    playErrorSound: {
      name: "Play Error Sound",
      description: "Play a sound when errors occur",
    },
  };

  // Extract UI styles
  const STYLES = {
    button: `
            position:fixed;
            bottom:20px;
            right:20px;
            background:#2f2f2f;
            color:white;
            padding:10px 15px;
            border-radius:4px;
            cursor:pointer;
            box-shadow:0 2px 8px rgba(0,0,0,0.2);
            z-index:9999;
            font-family:-apple-system, system-ui, sans-serif;
            font-size:14px;
            transition:all 0.2s ease;
            border:none;`,
    modal: `
            position:fixed;
            top:50%;
            left:50%;
            transform:translate(-50%, -50%);
            background:#2f2f2f;
            color:#dadada;
            padding:25px;
            border-radius:4px;
            box-shadow:0 2px 20px rgba(0,0,0,0.3);
            z-index:10000;
            min-width:300px;
            max-width:90%;
            max-height:90vh;
            overflow-y:auto;
            font-family:-apple-system, system.ui, sans-serif;`,
    settings: `
            margin:0 0 20px 0;
            color:#da8e35;
            font-size:18px;
            font-weight:600;`,
    section: `
            background:#363636;
            padding:15px;
            border-radius:4px;
            margin-bottom:15px;`,
    sectionHeader: `
            color:#da8e35;
            margin:0 0 10px 0;
            font-size:16px;
            font-weight:500;`,
    input: `
            background:#2f2f2f;
            border:1px solid #444;
            color:#dadada;
            border-radius:3px;
            padding:5px;`,
    btn: {
      primary: `
                padding:8px 15px;
                border:none;
                background:#da8e35;
                color:white;
                border-radius:3px;
                cursor:pointer;
                transition:all 0.2s ease;`,
      secondary: `
                padding:8px 15px;
                border:1px solid #da8e35;
                background:transparent;
                color:#da8e35;
                border-radius:3px;
                cursor:pointer;
                transition:all 0.2s ease;`,
      advanced: `
                padding: 4px 8px;
                border: none;
                background: transparent;
                color: #666;
                font-size: 12px;
                cursor: pointer;
                transition: all 0.2s ease;
                opacity: 0.6;
                text-decoration: underline;
                &:hover {
                    opacity: 1;
                    color: #da8e35;
                }`,
    },
  };

  function createSettingsUI() {
    const btn = document.createElement("div");
    btn.innerHTML = "NexusNoWait++ ⚙️";
    btn.style.cssText = STYLES.button;

    btn.onmouseover = () => (btn.style.transform = "translateY(-2px)");
    btn.onmouseout = () => (btn.style.transform = "translateY(0)");
    btn.onclick = () => {
      if (activeModal) {
        activeModal.remove();
        activeModal = null;
        if (settingsChanged) {
          location.reload();
        }
      } else {
        showSettingsModal();
      }
    };
    document.body.appendChild(btn);
  }

  function generateSettingsHTML() {
    const normalBooleanSettings = Object.entries(SETTING_UI)
      .filter(
        ([key]) => typeof config[key] === "boolean" && !["debug"].includes(key)
      )
      .map(
        ([key, { name, description }]) => `
                <div style="margin-bottom:10px;">
                    <label title="${description}" style="display:flex;align-items:center;gap:8px;">
                        <input type="checkbox"
                               ${config[key] ? "checked" : ""}
                               data-setting="${key}">
                        <span>${name}</span>
                    </label>
                </div>`
      )
      .join("");

    const numberSettings = Object.entries(SETTING_UI)
      .filter(([key]) => typeof config[key] === "number")
      .map(
        ([key, { name, description }]) => `
                <div style="margin-bottom:10px;">
                    <label title="${description}" style="display:flex;align-items:center;justify-content:space-between;">
                        <span>${name}:</span>
                        <input type="number"
                               value="${config[key]}"
                               min="0"
                               step="100"
                               data-setting="${key}"
                               style="${STYLES.input};width:120px;">
                    </label>
                </div>`
      )
      .join("");

    const advancedSection = `
            <div id="advancedSection" style="display:none;">
                <div style="${STYLES.section}">
                    <h4 style="${STYLES.sectionHeader}">Advanced Settings</h4>
                    <div style="margin-bottom:10px;">
                        <label title="${
                          SETTING_UI.debug.description
                        }" style="display:flex;align-items:center;gap:8px;">
                            <input type="checkbox"
                                   ${config.debug ? "checked" : ""}
                                   data-setting="debug">
                            <span>${SETTING_UI.debug.name}</span>
                        </label>
                    </div>
                </div>
            </div>`;

    return `
            <h3 style="${STYLES.settings}">NexusNoWait++ Settings</h3>
            <div style="${STYLES.section}">
                <h4 style="${STYLES.sectionHeader}">Features</h4>
                ${normalBooleanSettings}
            </div>
            <div style="${STYLES.section}">
                <h4 style="${STYLES.sectionHeader}">Timing</h4>
                ${numberSettings}
            </div>
            ${advancedSection}
            <div style="margin-top:20px;display:flex;justify-content:center;gap:10px;">
                <button id="resetSettings" style="${STYLES.btn.secondary}">Reset</button>
                <button id="closeSettings" style="${STYLES.btn.primary}">Save & Close</button>
            </div>
            <div style="text-align: center; margin-top: 15px;">
                <button id="toggleAdvanced" style="${STYLES.btn.advanced}">⚙️ Advanced</button>
            </div>
            <div style="text-align: center; margin-top: 15px; color: #666; font-size: 12px;">
                Version ${GM_info.script.version}
                \n by Torkelicious
            </div>`;
  }

  let activeModal = null;
  let settingsChanged = false; // Track settings changes

  function showSettingsModal() {
    if (activeModal) {
      activeModal.remove();
    }

    settingsChanged = false; // Reset change tracker
    const modal = document.createElement("div");
    modal.style.cssText = STYLES.modal;

    modal.innerHTML = generateSettingsHTML();

    function updateSetting(element) {
      const setting = element.getAttribute("data-setting");
      const value =
        element.type === "checkbox"
          ? element.checked
          : parseInt(element.value, 10);

      if (typeof value === "number" && isNaN(value)) {
        element.value = config[setting];
        return;
      }

      if (config[setting] !== value) {
        settingsChanged = true;
        window.nexusConfig.setFeature(setting, value);
      }
    }

    modal.addEventListener("change", (e) => {
      if (e.target.hasAttribute("data-setting")) {
        updateSetting(e.target);
      }
    });

    modal.addEventListener("input", (e) => {
      if (e.target.type === "number" && e.target.hasAttribute("data-setting")) {
        updateSetting(e.target);
      }
    });

    modal.querySelector("#closeSettings").onclick = () => {
      modal.remove();
      activeModal = null;
      if (settingsChanged) {
        location.reload();
      }
    };

    modal.querySelector("#resetSettings").onclick = () => {
      settingsChanged = true;
      window.nexusConfig.reset();
      saveSettings(config);
      modal.remove();
      activeModal = null;
      location.reload();
    };

    modal.querySelector("#toggleAdvanced").onclick = (e) => {
      const section = modal.querySelector("#advancedSection");
      const isHidden = section.style.display === "none";
      section.style.display = isHidden ? "block" : "none";
      e.target.textContent = `Advanced ${isHidden ? "▲" : "▼"}`;
    };

    document.body.appendChild(modal);
    activeModal = modal;
  }

  // Override console when debug is enabled
  function setupDebugMode() {
    if (config.debug) {
      const originalConsole = {
        log: console.log,
        warn: console.warn,
        error: console.error,
      };

      console.log = function () {
        originalConsole.log.apply(console, arguments);
        alert("[Debug Log]\n" + Array.from(arguments).join(" "));
      };

      console.warn = function () {
        originalConsole.warn.apply(console, arguments);
        alert("[Debug Warn]\n" + Array.from(arguments).join(" "));
      };

      console.error = function () {
        originalConsole.error.apply(console, arguments);
        alert("[Debug Error]\n" + Array.from(arguments).join(" "));
      };
    }
  }

  // === Configuration ===
  window.nexusConfig = {
    setFeature: (name, value) => {
      const oldValue = config[name];
      config[name] = value;
      saveSettings(config);

      if (name !== "debug") {
        applySettings();
      }

      if (oldValue !== value) {
        settingsChanged = true;
      }
    },

    reset: () => {
      GM_deleteValue("nexusNoWaitConfig");
      Object.assign(config, DEFAULT_CONFIG);
      saveSettings(config);
      applySettings();
    },

    getConfig: () => config,
  };

  function applySettings() {
    setupDebugMode();
  }
  // ------------------------------------------------------------------------------------------------ //

  // ===  Initialization ===
  function isModPage() {
    return /nexusmods\.com\/.*\/mods\//.test(window.location.href);
  }

  function initializeUI() {
    applySettings();
    createSettingsUI();
  }

  function initMainFunctions() {
    if (!isModPage()) return;

    archivedFile();
    addClickListeners(document.querySelectorAll("a.btn"));
    // Also observe new "action bar" buttons if they lack .btn for some reason
    const actionManual = document.querySelector("#action-manual a");
    const actionNmm = document.querySelector("#action-nmm a");
    if (actionManual) addClickListener(actionManual);
    if (actionNmm) addClickListener(actionNmm);

    autoStartFileLink();
    if (config.skipRequirements) {
      autoClickRequiredFileDownload();
    }
  }

  // Combined observer
  const mainObserver = new MutationObserver((mutations) => {
    if (!isModPage()) return;

    try {
      mutations.forEach((mutation) => {
        if (!mutation.addedNodes) return;

        mutation.addedNodes.forEach((node) => {
          if (node.tagName === "A" && node.classList?.contains("btn")) {
            addClickListener(node);
          }

          if (node.querySelectorAll) {
            // Attach to regular buttons and new action bar links
            addClickListeners(node.querySelectorAll("a.btn"));
            const manu = node.querySelectorAll?.("#action-manual a");
            manu && manu.forEach?.((el) => addClickListener(el));
            const nmm = node.querySelectorAll?.("#action-nmm a");
            nmm && nmm.forEach?.((el) => addClickListener(el));
          }
        });
      });
    } catch (error) {
      console.error("Error in mutation observer:", error);
    }
  });

  // Initialize everything
  initializeUI();
  initMainFunctions();

  // Start observing
  mainObserver.observe(document, {
    childList: true,
    subtree: true,
  });

  // Cleanup on page unload
  window.addEventListener("unload", () => {
    mainObserver.disconnect();
  });
})();
