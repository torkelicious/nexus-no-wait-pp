// ==UserScript==
// @name        Nexus No Wait ++
// @description Download from nexusmods.com without wait (Manual/Vortex/MO2/NMM), Tweaked with extra features.
// @namespace   NexusNoWaitPlusPlus
// @author      Torkelicious
// @version     1.1.14
// @include     https://*.nexusmods.com/*
// @run-at      document-idle
// @iconURL     https://raw.githubusercontent.com/torkelicious/nexus-no-wait-pp/refs/heads/main/icon.png
// @icon        https://raw.githubusercontent.com/torkelicious/nexus-no-wait-pp/refs/heads/main/icon.png
// @grant       GM_xmlhttpRequest
// @grant       GM.xmlHttpRequest
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_deleteValue
// @grant       GM_info
// @connect     nexusmods.com
// @connect     *.nexusmods.com
// @connect     raw.githubusercontent.com
// @license     GPL-3.0-or-later
// ==/UserScript==

/* global GM_getValue, GM_setValue, GM_deleteValue, GM_xmlhttpRequest, GM.xmlHttpRequest, GM_info GM */

(function () {
  const DEFAULT_CONFIG = {
    autoCloseTab: true,
    skipRequirements: true,
    showAlerts: true,
    refreshOnError: false,
    requestTimeout: 30000,
    closeTabTime: 1000,
    debug: false,
    playErrorSound: true,
  };

  const RECENT_HANDLE_MS = 600;

  // logging helpers
  function debugLog(...args) {
    try {
      const prefix = "[Nexus No Wait ++]";
      (console.debug || console.log).call(
        console,
        prefix,
        ...args,
        "Page:",
        window.location.href,
      );
    } catch (e) {}
  }
  function infoLog(...args) {
    try {
      (console.info || console.log).call(
        console,
        "[Nexus No Wait ++]",
        ...args,
        "Page:",
        window.location.href,
      );
    } catch (e) {}
  }
  function errorLog(...args) {
    try {
      (console.error || console.log).call(
        console,
        "[Nexus No Wait ++]",
        ...args,
        "Page:",
        window.location.href,
      );
    } catch (e) {}
  }

  // === Settings management ===
  function validateSettings(settings) {
    if (!settings || typeof settings !== "object") return { ...DEFAULT_CONFIG };
    const validated = { ...settings };
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
      let parsed;
      if (!saved) parsed = DEFAULT_CONFIG;
      else if (typeof saved === "string") {
        try {
          parsed = JSON.parse(saved);
        } catch (e) {
          parsed = DEFAULT_CONFIG;
        }
      } else parsed = saved;
      const validated = validateSettings(parsed);
      debugLog("Loaded settings", validated);
      return validated;
    } catch (e) {
      debugLog("Failed loading settings:", e);
      return { ...DEFAULT_CONFIG };
    }
  }
  function saveSettings(settings) {
    try {
      try {
        GM_setValue("nexusNoWaitConfig", settings);
      } catch (_) {
        GM_setValue("nexusNoWaitConfig", JSON.stringify(settings));
      }
      debugLog("Saved settings");
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  }
  const config = Object.assign({}, DEFAULT_CONFIG, loadSettings());

  // Error sound
  const errorSound = new Audio(
    "https://github.com/torkelicious/nexus-no-wait-pp/raw/refs/heads/main/errorsound.mp3",
  );
  try {
    errorSound.load();
  } catch (e) {
    debugLog("Could not preload sound", e);
  }
  function playErrorSound() {
    if (!config.playErrorSound) return;
    errorSound.play().catch((e) => debugLog("Error playing sound:", e));
  }

  // Error/log helpers used by UI
  function logMessage(message, showAlert = false, isDebug = false) {
    if (isDebug) {
      debugLog(message);
      if (config.debug) alert("[Nexus No Wait ++] (Debug):\n" + message);
      return;
    }
    playErrorSound();
    errorLog(message);
    if (showAlert && config.showAlerts) alert("[Nexus No Wait ++]\n" + message);
    if (config.refreshOnError) location.reload();
  }

  // ----------------- download URL text extractor thing -----------------
  function extractDownloadUrlTxt(text) {
    if (!text) return null;
    text = String(text);

    // common JS assignment patterns (const|let|var downloadUrl = '...';)
    let m = text.match(/(?:const|let|var)\s+downloadUrl\s*=\s*(['"])(.*?)\1/);
    if (m && m[2]) return m[2].replace(/&amp;/g, "&");

    // generic key:value or key = '...' patterns (downloadUrl: '...' or downloadUrl = "...")
    m = text.match(/downloadUrl\s*[:=]\s*(['"])(.*?)\1/);
    if (m && m[2]) return m[2].replace(/&amp;/g, "&");

    // data-download-url attribute in raw HTML
    m = text.match(/data-download-url\s*=\s*(['"])(.*?)\1/);
    if (m && m[2]) return m[2].replace(/&amp;/g, "&");

    // loose search for tokenized download URL containing "/download/"
    m = text.match(/https?:\/\/[^"'<>\\\s]+\/download\/[^"'<>\\\s]*/i);
    if (m && m[0]) return m[0].replace(/&amp;/g, "&");

    // nxm:// link anywhere
    m = text.match(/(nxm:\/\/[^\s"'<>]+)/i);
    if (m && m[1]) return m[1];

    return null;
  }
  // -------------------------------------------------------------------------

  // Skip requirements tab
  if (
    window.location.href.includes("tab=requirements") &&
    config.skipRequirements
  ) {
    const newUrl = window.location.href.replace(
      "tab=requirements",
      "tab=files",
    );
    infoLog("Skipping requirements tab -> files", {
      from: window.location.href,
      to: newUrl,
    });
    window.location.replace(newUrl);
    return;
  }

  // === AJAX wrapper ===
  // Use Greasemonkey GM.xmlHttpRequest when present,
  // otherwise GM_xmlhttpRequest fallback
  let ajaxRequestRaw;
  if (typeof GM !== "undefined" && typeof GM.xmlHttpRequest === "function") {
    ajaxRequestRaw = GM.xmlHttpRequest;
  } else if (typeof GM_xmlhttpRequest !== "undefined") {
    ajaxRequestRaw = GM_xmlhttpRequest;
  }

  function ajaxRequest(obj) {
    if (!ajaxRequestRaw) {
      logMessage(
        "AJAX not available in this environment (your userscript manager may not support this!)",
        true,
      );
      return;
    }
    debugLog("ajaxRequest", {
      method: obj.type,
      url: obj.url,
      dataPreview:
        typeof obj.data === "string" ? obj.data.slice(0, 200) : obj.data,
    });
    ajaxRequestRaw({
      method: obj.type,
      url: obj.url,
      data: obj.data,
      headers: obj.headers,
      timeout: config.requestTimeout,
      onload(response) {
        const body =
          typeof response.response !== "undefined"
            ? response.response
            : response.responseText;
        debugLog("ajax response", {
          status: response.status,
          length: body ? body.length || 0 : 0,
          preview: body ? String(body).slice(0, 500) : "",
        });
        if (response.status >= 200 && response.status < 300) obj.success(body);
        else obj.error(response);
      },
      onerror(response) {
        obj.error(response);
      },
      ontimeout(response) {
        obj.error(response);
      },
    });
  }

  // === Button UI helpers ===
  function btnError(button, error) {
    try {
      if (button && button.style) button.style.color = "red";
      let message = "Download failed: ";
      if (error) {
        if (typeof error === "string") message += error;
        else if (error.message) message += error.message;
        else if (error.status)
          message += `HTTP ${error.status} ${error.statusText || ""}`;
        else if (typeof error.responseText === "string")
          message += error.responseText.slice(0, 300);
        else message += JSON.stringify(error);
      } else message += "Unknown error";
      if (button && "innerText" in button)
        button.innerText = "ERROR: " + message;
      errorLog(message);
      logMessage(message, true);
    } catch (e) {
      logMessage(
        "Unknown error while handling button error: " + e.message,
        true,
      );
    }
  }
  function btnSuccess(button) {
    if (button && button.style) button.style.color = "green";
    if (button && "innerText" in button) button.innerText = "Downloading!";
    infoLog("Download started (UI updated).", { button });
  }
  function btnWait(button) {
    if (button && button.style) button.style.color = "yellow";
    if (button && "innerText" in button) button.innerText = "Wait...";
    debugLog("Set button to wait", { button });
  }

  function closeOnDL() {
    if (config.autoCloseTab) {
      debugLog("Scheduling close", { delay: config.closeTabTime });
      setTimeout(() => {
        debugLog("Closing window");
        window.close();
      }, config.closeTabTime);
    }
  }

  // Primary file id extractor
  function getPrimaryFileId() {
    try {
      // action-nmm link (vortex)
      const vortexAction = document.querySelector(
        '#action-nmm a[href*="file_id="]',
      );
      if (vortexAction) {
        const fid = new URL(vortexAction.href, location.href).searchParams.get(
          "file_id",
        );
        if (fid) {
          debugLog("getPrimaryFileId found via action-nmm", fid);
          return fid;
        }
      }

      // any file link with file_id
      const anyFileLink = document.querySelector('a[href*="file_id="]');
      if (anyFileLink) {
        const fid = new URL(anyFileLink.href, location.href).searchParams.get(
          "file_id",
        );
        if (fid) {
          debugLog("getPrimaryFileId found via any file link", fid);
          return fid;
        }
      }

      // file-expander-header[data-id]
      const header = document.querySelector(".file-expander-header[data-id]");
      if (header) {
        const fid = header.getAttribute("data-id");
        if (fid) {
          debugLog("getPrimaryFileId found via header", fid);
          return fid;
        }
      }

      // fallback data-fileid / data-id attributes
      const dataFile = document.querySelector("[data-fileid], [data-id]");
      if (dataFile) {
        const fid =
          dataFile.getAttribute("data-fileid") ||
          dataFile.getAttribute("data-id") ||
          (dataFile.dataset && dataFile.dataset.fileid);
        if (fid) {
          debugLog("getPrimaryFileId found via data-fileid/data-id", fid);
          return fid;
        }
      }
    } catch (e) {
      debugLog("getPrimaryFileId error", e);
    }
    debugLog("getPrimaryFileId: none found");
    return null;
  }

  // === MAIN DOWNLOAD HANDLER ===
  function clickListener(event) {
    console.groupCollapsed("[NNW++] clickListener");

    // duplicate-handling guard
    try {
      if (this && this.dataset && this.dataset.nnwHandled === "1") {
        debugLog("Element recently handled, skipping duplicate");
        console.groupEnd();
        return;
      }
      try {
        if (this && this.dataset) this.dataset.nnwHandled = "1";
      } catch (_) {}
      try {
        if (this)
          setTimeout(() => {
            try {
              if (this && this.dataset) delete this.dataset.nnwHandled;
            } catch (_) {}
          }, RECENT_HANDLE_MS);
      } catch (_) {}
      if (event) {
        try {
          event.__nnw_nofollow = true;
        } catch (_) {}
      }
    } catch (e) {
      debugLog("Guard error", e);
    }

    try {
      debugLog("clickListener start", {
        target: this,
        href: (this && this.href) || window.location.href,
      });

      const selfIsElement = this && this.tagName;
      const href = (selfIsElement && this.href) || window.location.href;
      const params = new URL(href, location.href).searchParams;

      if (params.get("file_id")) {
        infoLog("file link clicked", { href });
        let button = event;
        if (selfIsElement && this.href) {
          button = this;
          try {
            if (event && typeof event.preventDefault === "function")
              event.preventDefault();
          } catch (_) {}
        }
        btnWait(button);

        const section = document.getElementById("section");
        const gameId = section ? section.dataset.gameId : this.current_game_id;
        let fileId = params.get("file_id") || params.get("id");

        // create POST options early so we can reuse for NMM GET if needed
        const postOptions = {
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
            debugLog(
              "file link POST response preview:",
              String(data).slice(0, 1200),
            );
            if (!data) {
              btnError(button, {
                message: "Empty response from server",
              });
              console.groupEnd();
              return;
            }
            // first JSON parse
            let parsed = null;
            try {
              parsed = typeof data === "string" ? JSON.parse(data) : data;
            } catch (e) {
              parsed = null;
            }
            if (parsed && parsed.url) {
              infoLog("Using parsed.url from POST", parsed.url);
              btnSuccess(button);
              try {
                document.location.href = parsed.url;
              } catch (_) {
                window.location = parsed.url;
              }
              console.groupEnd();
              return;
            }

            // fallback to loose text extraction (nxm/http or embedded JS)
            const regexUrl = extractDownloadUrlTxt(String(data));
            if (regexUrl) {
              infoLog(
                "Falling back to text-extracted URL from POST response",
                regexUrl,
              );
              btnSuccess(button);
              try {
                document.location.href = regexUrl;
              } catch (_) {
                window.location = regexUrl;
              }
              console.groupEnd();
              return;
            }

            btnError(button, {
              message:
                "No download URL returned from server\n\n(Are you logged in?)",
            });
            console.groupEnd();
          },
          error(xhr) {
            btnError(button, xhr);
            console.groupEnd();
          },
        };

        // NMM
        if (params.get("nmm")) {
          infoLog("nmm parameter present -> performing NMM GET extraction", {
            href,
          });
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
              debugLog(
                "NMM GET response preview:",
                String(data).slice(0, 1200),
              );
              if (!data) {
                btnError(button, {
                  message: "Empty response from server",
                });
                console.groupEnd();
                return;
              }
              try {
                const doc = new DOMParser().parseFromString(
                  String(data),
                  "text/html",
                );
                const slow =
                  doc.getElementById("slowDownloadButton") ||
                  doc.querySelector("[data-download-url]");
                if (slow) {
                  const downloadUrl =
                    slow.getAttribute("data-download-url") ||
                    (slow.dataset && slow.dataset.downloadUrl) ||
                    slow.href;
                  if (downloadUrl) {
                    infoLog("Found data-download-url (NMM)", downloadUrl);
                    btnSuccess(button);
                    try {
                      document.location.href = downloadUrl;
                    } catch (_) {
                      window.location = downloadUrl;
                    }
                    console.groupEnd();
                    return;
                  } else {
                    // if the slow button exists but no data attr continue to fallbacks
                    debugLog(
                      "slowDownloadButton found but no data-download-url attr",
                    );
                  }
                }

                // Try JSON parse (some responses are JSON)
                let parsed = null;
                try {
                  parsed = typeof data === "string" ? JSON.parse(data) : data;
                } catch (e) {
                  parsed = null;
                }
                if (parsed && parsed.url) {
                  infoLog("Found parsed.url in NMM GET response", parsed.url);
                  btnSuccess(button);
                  try {
                    document.location.href = parsed.url;
                  } catch (_) {
                    window.location = parsed.url;
                  }
                  console.groupEnd();
                  return;
                }

                // try text based extraction
                const regexUrl = extractDownloadUrlTxt(String(data));
                if (regexUrl) {
                  infoLog(
                    "Found download URL via text extraction (NMM GET)",
                    regexUrl,
                  );
                  btnSuccess(button);
                  try {
                    document.location.href = regexUrl;
                  } catch (_) {
                    window.location = regexUrl;
                  }
                  console.groupEnd();
                  return;
                }

                // last fallback to call the POST GenerateDownloadUrl (same as manual)
                debugLog(
                  "NMM GET: no URL found, falling back to GenerateDownloadUrl POST for fid=" +
                    fileId,
                );
                ajaxRequest(postOptions);
              } catch (e) {
                btnError(button, e);
                console.groupEnd();
              }
            },
            error(xhr) {
              btnError(button, xhr);
              console.groupEnd();
            },
          });
          return;
        }
        // Non-nmm flow uses postOptions
        ajaxRequest(postOptions);

        const popup = selfIsElement ? this.parentNode : null;
        if (popup && popup.classList.contains("popup")) {
          popup.getElementsByTagName("button")[0]?.click();
          const popupButton = document.getElementById("popup" + fileId);
          if (popupButton) {
            btnSuccess(popupButton);
          }
        }
        return;
      }

      // mirror ModRequirementsPopUp id for element for later lookup
      if (/ModRequirementsPopUp/.test(href)) {
        const fileId = new URL(href, location.href).searchParams.get("id");
        if (fileId && selfIsElement) {
          this.setAttribute("id", "popup" + fileId);
        }
      }
    } catch (err) {
      errorLog("Unhandled error in clickListener", err);
    } finally {
      try {
        if (this && this.dataset) delete this.dataset.nnwProcessing;
      } catch (_) {}
      console.groupEnd();
    }
  }

  // === Event delegation ===
  function delegatedClickHandler(event) {
    try {
      const selector = [
        "#slowDownloadButton",
        "#action-manual a",
        "#action-nmm a",
        'a[href*="file_id="]',
        "a.btn",
      ].join(",");
      const el =
        event.target && event.target.closest
          ? event.target.closest(selector)
          : null;
      if (!el) return;

      if (event && event.__nnw_nofollow) {
        debugLog("delegatedClickHandler: event already handled, skipping");
        return;
      }
      clickListener.call(el, event);
    } catch (e) {
      debugLog("delegatedClickHandler error", e);
    }
  }

  // Autostart when file_id present in URL
  function autoStartFileLink() {
    if (/file_id=/.test(window.location.href)) {
      debugLog("autoStartFileLink detected file_id in URL");
      try {
        const slowButton = document.getElementById("slowDownloadButton");
        if (slowButton) clickListener.call(slowButton, null);
        closeOnDL();
      } catch (e) {
        debugLog("autoStartFileLink error", e);
      }
    }
  }

  function autoClickRequiredFileDownload() {
    let popupClicked = false;
    const observer = new MutationObserver(() => {
      const popup = document.querySelector(".popup-mod-requirements");
      if (popup) {
        if (!popupClicked) {
          const downloadButton = popup.querySelector("a.btn");
          const exitPopupBtn = popup.querySelector(".mfp-close");
          if (downloadButton) {
            infoLog("Requirements popup detected, auto-clicking download.");
            popupClicked = true;
            downloadButton.click();
            exitPopupBtn?.click();
          }
        }
      } else {
        if (popupClicked) {
          debugLog("Requirements popup closed, resetting click flag.");
          popupClicked = false;
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Archived files: inject nmm=1 and Manual buttons
  const ICON_PATHS = {
    nmm: "https://www.nexusmods.com/assets/images/icons/icons.svg#icon-nmm",
    manual:
      "https://www.nexusmods.com/assets/images/icons/icons.svg#icon-manual",
  };

  function createArchiveButtonsFor(fileId) {
    const path = `${location.protocol}//${location.host}${location.pathname}`;
    const fragment = document.createDocumentFragment();

    const makeBtn = (href, label, isNmm) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.className = "btn inline-flex";
      a.href = href;
      a.dataset.fileid = fileId;
      a.tabIndex = 0;
      try {
        const svg = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        svg.setAttribute(
          "class",
          "icon " + (isNmm ? "icon-nmm" : "icon-manual"),
        );
        const use = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "use",
        );
        use.setAttributeNS(
          "http://www.w3.org/1999/xlink",
          "xlink:href",
          isNmm ? ICON_PATHS.nmm : ICON_PATHS.manual,
        );
        svg.appendChild(use);
        a.appendChild(svg);
      } catch (_) {
        const spanIcon = document.createElement("span");
        spanIcon.className = "icon " + (isNmm ? "icon-nmm" : "icon-manual");
        a.appendChild(spanIcon);
      }

      const labelSpan = document.createElement("span");
      labelSpan.className = "flex-label";
      labelSpan.textContent = label;
      a.appendChild(labelSpan);

      li.appendChild(a);
      return li;
    };

    const nmmHref = `${path}?tab=files&file_id=${encodeURIComponent(
      fileId,
    )}&nmm=1`;
    const manualHref = `${path}?tab=files&file_id=${encodeURIComponent(
      fileId,
    )}`;

    fragment.appendChild(makeBtn(nmmHref, "Vortex", true));
    fragment.appendChild(makeBtn(manualHref, "Manual", false));
    return fragment;
  }

  function archivedFile() {
    try {
      if (!window.location.href.includes("category=archived")) return;

      const downloadSections = Array.from(
        document.querySelectorAll(".accordion-downloads"),
      );
      const fileHeaders = Array.from(
        document.querySelectorAll(".file-expander-header"),
      );

      for (let idx = 0; idx < downloadSections.length; idx++) {
        const section = downloadSections[idx];
        const fileId = fileHeaders[idx]?.getAttribute("data-id");
        if (!fileId) continue;
        try {
          if (section.dataset && section.dataset.nnwInjected === fileId) {
            continue;
          }
        } catch (_) {}

        infoLog("archivedFile: injecting buttons (safe DOM creation)", {
          fileId,
        });
        while (section.firstChild) section.removeChild(section.firstChild);
        section.appendChild(createArchiveButtonsFor(fileId));

        try {
          if (section.dataset) section.dataset.nnwInjected = fileId;
        } catch (_) {}
      }
    } catch (e) {
      errorLog("archivedFile error", e);
    }
  }

  // -------------------------------- UI --------------------------------
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
      description: "Delay before closing tab after download starts",
    },
    debug: {
      name: "⚠️ Debug Alerts",
      description: "Show all console logs as alerts",
    },
    playErrorSound: {
      name: "Play Error Sound",
      description: "Play a sound when errors occur",
    },
  };

  const STYLES = {
    button: `position:fixed;bottom:20px;right:20px;background:#2f2f2f;color:#fff;padding:10px 15px;border-radius:4px;cursor:pointer;z-index:9999;font-family:'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif;font-size:14px;border:none;`,
    modal: `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#2f2f2f;color:#dadada;padding:25px;border-radius:4px;z-index:10000;min-width:300px;max-width:90%;max-height:90vh;overflow-y:auto;font-family:'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif;`,
    section: `background:#363636;padding:15px;border-radius:4px;margin-bottom:15px;`,
    sectionHeader: `color:#da8e35;margin:0 0 10px 0;font-size:16px;font-weight:500;`,
    input: `background:#2f2f2f;border:1px solid #444;color:#dadada;border-radius:3px;padding:5px;`,
    btn: {
      primary: `padding:8px 15px;border:none;background:#da8e35;color:white;border-radius:3px;cursor:pointer;`,
      secondary: `padding:8px 15px;border:1px solid #da8e35;background:transparent;color:#da8e35;border-radius:3px;cursor:pointer;`,
      advanced: `padding:4px 8px;background:transparent;color:#666;border:none;cursor:pointer;`,
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
        if (settingsChanged) location.reload();
      } else showSettingsModal();
    };
    document.body.appendChild(btn);
  }

  function generateSettingsHTML() {
    const normalBooleanSettings = Object.entries(SETTING_UI)
      .filter(([k]) => typeof config[k] === "boolean" && k !== "debug")
      .map(
        ([key, { name, description }]) => `
        <div style="margin-bottom:10px;">
          <label title="${description}" style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" ${
              config[key] ? "checked" : ""
            } data-setting="${key}">
            <span>${name}</span>
          </label>
        </div>`,
      )
      .join("");
    const numberSettings = Object.entries(SETTING_UI)
      .filter(([key]) => typeof config[key] === "number")
      .map(
        ([key, { name, description }]) => `
        <div style="margin-bottom:10px;">
          <label title="${description}" style="display:flex;align-items:center;justify-content:space-between;">
            <span>${name}:</span>
            <input type="number" value="${config[key]}" min="0" step="100" data-setting="${key}" style="${STYLES.input};width:120px;">
          </label>
        </div>`,
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
              <input type="checkbox" ${
                config.debug ? "checked" : ""
              } data-setting="debug"><span>${SETTING_UI.debug.name}</span>
            </label>
          </div>
        </div>
      </div>`;
    return `
      <h3 style="${STYLES.sectionHeader}">NexusNoWait++ Settings</h3>
      <div style="${STYLES.section}"><h4 style="${STYLES.sectionHeader}">Features</h4>${normalBooleanSettings}</div>
      <div style="${STYLES.section}"><h4 style="${STYLES.sectionHeader}">Timing</h4>${numberSettings}</div>
      ${advancedSection}
      <div style="display:flex;justify-content:center;gap:10px;margin-top:20px;">
        <button id="resetSettings" style="${STYLES.btn.secondary}">Reset</button>
        <button id="closeSettings" style="${STYLES.btn.primary}">Save & Close</button>
      </div>
      <div style="text-align:center;margin-top:12px;"><button id="toggleAdvanced" style="${STYLES.btn.advanced}">⚙️ Advanced</button></div>
      <div style="text-align:center;margin-top:12px;color:#666;font-size:12px;">Version ${GM_info.script.version} by Torkelicious</div>
    `;
  }

  let activeModal = null;
  let settingsChanged = false;

  function showSettingsModal() {
    if (activeModal) activeModal.remove();
    settingsChanged = false;
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
      if (e.target.hasAttribute("data-setting")) updateSetting(e.target);
    });
    modal.addEventListener("input", (e) => {
      if (e.target.type === "number" && e.target.hasAttribute("data-setting"))
        updateSetting(e.target);
    });

    modal.querySelector("#closeSettings").onclick = () => {
      modal.remove();
      activeModal = null;
      if (settingsChanged) location.reload();
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
      infoLog("Debug mode enabled");
    }
  }

  function scrollToMainFiles() {
    try {
      if (!/\btab=files\b/.test(window.location.href)) return;
      const header = document.querySelector(".file-category-header");
      if (header) header.scrollIntoView();
    } catch (e) {
      /* ignore */
    }
  }

  window.nexusConfig = {
    setFeature(name, value) {
      const old = config[name];
      config[name] = value;
      saveSettings(config);
      if (name !== "debug") applySettings();
      if (old !== value) {
        settingsChanged = true;
        debugLog("Feature changed", name, old, value);
      }
    },
    reset() {
      GM_deleteValue("nexusNoWaitConfig");
      Object.assign(config, DEFAULT_CONFIG);
      saveSettings(config);
      applySettings();
    },
    getConfig() {
      return config;
    },
  };
  function applySettings() {
    setupDebugMode();
  }

  // Initialization
  function isModPage() {
    return /nexusmods\.com\/.*\/mods\//.test(window.location.href);
  }
  function initializeUI() {
    applySettings();
    createSettingsUI();
  }

  function initMainFunctions() {
    if (!isModPage()) {
      debugLog("Not a mod page - skipping");
      return;
    }
    infoLog("Initializing main functions");
    archivedFile();
    document.body.addEventListener("click", delegatedClickHandler, true);
    try {
      getPrimaryFileId();
    } catch (e) {
      debugLog("initMainFunctions: getPrimaryFileId failed", e);
    }
    autoStartFileLink();
    if (config.skipRequirements) autoClickRequiredFileDownload();
    setTimeout(() => {
      try {
        scrollToMainFiles();
      } catch (e) {
        /* ignore */
      }
    }, 200);
  }

  // URL Watcher
  (() => {
    let lastHref = location.href;
    const CHECK_MS = 300;

    setInterval(() => {
      try {
        if (location.href === lastHref) return;
        lastHref = location.href;
        debugLog("URL changed ---> running light init for changed tab", {
          href: lastHref,
        });
        // only run lightweight operations needed on navigation:
        if (isModPage()) {
          try {
            archivedFile();
          } catch (e) {
            debugLog("archivedFile error on URL change", e);
          }
          setTimeout(() => {
            try {
              scrollToMainFiles();
            } catch (e) {
              /* ignore */
            }
          }, 150);
        }
      } catch (e) {
        debugLog("URL watcher error", e);
      }
    }, CHECK_MS);
  })();

  let archivedDebounceTimer = null;
  const ARCHIVE_DEBOUNCE_MS = 200;

  const mainObserver = new MutationObserver((mutations) => {
    if (!isModPage()) return;
    try {
      let touched = false;
      mutations.forEach((mutation) => {
        if (!mutation.addedNodes) return;
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          touched = true;
        });
      });
      if (!touched) return;
      clearTimeout(archivedDebounceTimer);
      archivedDebounceTimer = setTimeout(() => {
        try {
          archivedFile();
        } finally {
          archivedDebounceTimer = null;
        }
      }, ARCHIVE_DEBOUNCE_MS);
    } catch (e) {
      errorLog("MutationObserver error", e);
    }
  });

  initializeUI();
  initMainFunctions();

  if (isModPage()) {
    mainObserver.observe(document.body, { childList: true, subtree: true });
    debugLog("Started mutation observer");
    window.addEventListener("unload", () => {
      mainObserver.disconnect();
      debugLog("Unload: disconnected observer");
    });
  }
})();
