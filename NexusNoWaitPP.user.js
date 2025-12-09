// ==UserScript==
// @name        Nexus No Wait ++
// @description Skip Countdown, Auto Download, and More for Nexus Mods. Supports (Manual/Vortex/MO2/NMM)
// @namespace   NexusNoWaitPlusPlus
// @author      Torkelicious
// @version     1.1.21
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
    closeTabTime: 2000,
    debug: false,
    playErrorSound: true,
    hidePremiumUpsells: false,
    errorSoundURL:
      "https://github.com/torkelicious/nexus-no-wait-pp/raw/refs/heads/main/errorsound.mp3",
  };

  const RECENT_HANDLE_MS = 600;

  // = = = = = unified logger = = = = =
  const LOG_PREFIX =
    "[ Nexus No Wait ++ | v" +
    ((typeof GM_info !== "undefined" && GM_info?.script?.version) || "?.?.?") +
    " ]\n";

  const logger = {
    debug(...args) {
      try {
        (console.debug || console.log).call(
          console,
          LOG_PREFIX,
          "[debug]:",
          ...args,
          "\nPage:",
          location.href,
        );
      } catch (e) {}
    },
    info(...args) {
      try {
        (console.info || console.log).call(
          console,
          LOG_PREFIX,
          "[info]:",
          ...args,
          "\nPage:",
          location.href,
        );
      } catch (e) {}
    },
    warn(...args) {
      try {
        (console.warn || console.log).call(
          console,
          LOG_PREFIX,
          "[warn]:",
          ...args,
          "\nPage:",
          location.href,
        );
      } catch (e) {}
    },
    error(...args) {
      try {
        (console.error || console.log).call(
          console,
          LOG_PREFIX,
          "[error]:",
          ...args,
          "\nPage:",
          location.href,
        );
      } catch (e) {}
    },
    groupCollapsed(...args) {
      try {
        (console.groupCollapsed || console.group || console.log).call(
          console,
          LOG_PREFIX,
          ...args,
        );
      } catch (e) {}
    },
    groupEnd() {
      try {
        (console.groupEnd || (() => {})).call(console);
      } catch (e) {}
    },
  };

  //  wrappers kept for compatibility
  // when config.debug is true debugLog will also show an alert.
  function debugLog(...args) {
    try {
      logger.debug(...args);
      if (config && config.debug) {
        try {
          const out = args
            .map((a) =>
              typeof a === "string" ? a : JSON.stringify(a, replacerSafe),
            )
            .join(" ");
          alert(LOG_PREFIX + " (Debug):\n" + out);
        } catch (e) {
          try {
            alert(LOG_PREFIX + " (Debug):\n" + String(args));
          } catch (_) {}
        }
      }
    } catch (e) {}
  }
  function infoLog(...args) {
    try {
      logger.info(...args);
    } catch (e) {}
  }
  function errorLog(...args) {
    try {
      logger.error(...args);
    } catch (e) {}
  }

  // avoid circular JSON.stringify errors in debug alerts
  function replacerSafe(key, value) {
    if (typeof value === "object" && value !== null) {
      try {
        // large DOM nodes or window references
        if (value instanceof Element) return "[DOM Element]";
      } catch (_) {}
    }
    return value;
  }

  // --------------------------------------------------------------------------

  // === Settings management ===
  function validateSettings(settings) {
    if (!settings || typeof settings !== "object")
      return {
        ...DEFAULT_CONFIG,
      };
    const validated = {
      ...settings,
    };
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
      return {
        ...DEFAULT_CONFIG,
      };
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
      errorLog("Failed to save settings:", e);
    }
  }
  const config = Object.assign({}, DEFAULT_CONFIG, loadSettings());

  // Error sound
  const errorSound = new Audio(config.errorSoundURL);
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
      if (config.debug) alert(LOG_PREFIX + " (Debug):\n" + message);
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

    // the new website version regex const downloadUrl = '...'
    let m = text.match(/const downloadUrl = '([^']+)'/);
    if (m && m[1]) {
      debugLog(
        "extractDownloadUrlTxt: Found new website version pattern (const downloadUrl = '...')",
      );
      return m[1].replace(/&amp;/g, "&");
    }

    // old website version regex id="slowDownloadButton" ... data-download-url="..."
    m = text.match(/id="slowDownloadButton".*?data-download-url="([^"]+)"/);
    if (m && m[1]) {
      debugLog(
        "extractDownloadUrlTxt: Found slowDownloadButton data-download-url attribute",
      );
      return m[1].replace(/&amp;/g, "&");
    }

    // common JS assignment patterns (const|let|var downloadUrl = '...';)
    m = text.match(/(?:const|let|var)\s+downloadUrl\s*=\s*(['"])(.*?)\1/);
    if (m && m[2]) {
      debugLog(
        "extractDownloadUrlTxt: Matched JS assignment pattern for downloadUrl",
      );
      return m[2].replace(/&amp;/g, "&");
    }

    // generic key:value or key = '...' patterns (downloadUrl: '...' or downloadUrl = "...")
    m = text.match(/downloadUrl\s*[:=]\s*(['"])(.*?)\1/);
    if (m && m[2]) {
      debugLog(
        "extractDownloadUrlTxt: Matched generic downloadUrl key/value pattern",
      );
      return m[2].replace(/&amp;/g, "&");
    }

    // data-download-url attribute in raw HTML
    m = text.match(/data-download-url\s*=\s*(['"])(.*?)\1/);
    if (m && m[2]) {
      debugLog(
        "extractDownloadUrlTxt: Matched data-download-url attribute in HTML",
      );
      return m[2].replace(/&amp;/g, "&");
    }

    // loose search for tokenized download URL containing "/download/"
    m = text.match(/https?:\/\/[^"'<>\\\s]+\/download\/[^"'<>\\\s]*/i);
    if (m && m[0]) {
      debugLog("extractDownloadUrlTxt: Matched loose /download/ URL token");
      return m[0].replace(/&amp;/g, "&");
    }

    // nxm:// link anywhere
    m = text.match(/(nxm:\/\/[^\s"'<>]+)/i);
    if (m && m[1]) {
      debugLog("extractDownloadUrlTxt: Matched nxm:// link");
      return m[1];
    }

    return null;
  }

  // unescape JSON escaped content for the text extractor when JSON.parse is skipped/failed.
  function tryjMatchUnescape(body) {
    if (!body) return "";
    body = String(body);

    // If there is a JSON like "url" field decode that part with JSON.parse
    try {
      const jMatch = body.match(/["']url["']\s*:\s*(['"])(.*?)\1/);
      if (jMatch && jMatch[2]) {
        try {
          // rewrap and JSON.parse only the captured part to decode escapes reliably
          const decodedFragment = JSON.parse(jMatch[1] + jMatch[2] + jMatch[1]);
          if (typeof decodedFragment === "string" && decodedFragment) {
            return String(decodedFragment);
          }
        } catch (e) {
          // fall through to broader unescape below
          debugLog(
            "tryjMatchUnescape: failed to JSON.parse fragment, will fallback to simple unescape",
            e,
          );
        }
      }
    } catch (e) {
      // ignore
    }

    //    Broad unescape for common JSON escapes so the text extractor regexes can match
    //    Handle common sequences to make regex matching more likely
    try {
      return body
        .replace(/\\\//g, "/")
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/\\\\/g, "\\")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t");
    } catch (e) {
      return body;
    }
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
    infoLog("Download started (UI updated).", {
      button,
    });
  }
  function btnWait(button) {
    if (button && button.style) button.style.color = "yellow";
    if (button && "innerText" in button) button.innerText = "Wait...";
    debugLog("Set button to wait", {
      button,
    });
  }

  function closeOnDL() {
    if (config.autoCloseTab) {
      debugLog("Scheduling close", {
        delay: config.closeTabTime,
      });
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
          debugLog("getPrimaryFileId found via anyFileLink", fid);
          return fid;
        }
      }

      // file-expander-header[data-id]
      const header = document.querySelector(".file-expander-header[data-id]");
      if (header) {
        const fid = header.getAttribute("data-id");
        if (fid) {
          debugLog("getPrimaryFileId found via file-expander-header", fid);
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
    logger.groupCollapsed("[NNW++] clickListener");

    // duplicate-handling guard
    try {
      if (this && this.dataset && this.dataset.nnwHandled === "1") {
        debugLog("Element recently handled, skipping duplicate");
        logger.groupEnd();
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
        infoLog("file link clicked", {
          href,
        });
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
              logger.groupEnd();
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
              infoLog("Using JSON parsed.url from POST response", parsed.url);
              btnSuccess(button);
              try {
                document.location.href = parsed.url;
              } catch (_) {
                window.location = parsed.url;
              }
              logger.groupEnd();
              return;
            }

            // JSON parse was skipped or failed try jMatch unescape + text extractor
            try {
              debugLog(
                "POST: attempting jMatch unescape + text-extractor fallback",
              );
              const body = String(data);
              const unescaped =
                typeof tryjMatchUnescape === "function"
                  ? tryjMatchUnescape(body)
                  : body.replace(/\\\//g, "/");

              debugLog(
                "POST: unescaped body preview:",
                unescaped.slice(0, 200),
              );

              // if unescaped is a raw URL use it immediately
              if (/^(https?:\/\/|nxm:\/\/)/i.test(unescaped.trim())) {
                const url = unescaped.trim().replace(/&amp;/g, "&");
                debugLog(
                  "POST: unescaped content is direct URL; navigating to:",
                  url,
                );
                btnSuccess(button);
                try {
                  document.location.href = url;
                } catch (_) {
                  window.location = url;
                }
                logger.groupEnd();
                return;
              }

              // Otherwise try extractor on unescaped content first
              let regexUrl = null;
              try {
                regexUrl = extractDownloadUrlTxt(unescaped);
                debugLog(
                  "POST: text-extractor matched URL on unescaped content:",
                  regexUrl,
                );
              } catch (e) {
                debugLog("POST: text-extractor threw on unescaped content", e);
              }

              // Fallback extractor on original body
              if (!regexUrl) {
                try {
                  regexUrl = extractDownloadUrlTxt(body);
                  debugLog(
                    "POST: text-extractor matched URL on original body:",
                    regexUrl,
                  );
                } catch (e) {
                  debugLog("POST: text-extractor threw on original body", e);
                }
              }

              if (regexUrl) {
                infoLog(
                  "Using text-extracted URL from POST response (after unescape fallback)",
                  regexUrl,
                );
                btnSuccess(button);
                try {
                  document.location.href = regexUrl;
                } catch (_) {
                  window.location = regexUrl;
                }
                logger.groupEnd();
                return;
              }

              debugLog("POST: unescape + text-extractor returned no URL");
            } catch (e) {
              debugLog("POST: unescape+extract fallback failed", e);
            }

            btnError(button, {
              message:
                "No download URL returned from server\n\n(Are you logged in?)",
            });
            logger.groupEnd();
          },
          error(xhr) {
            btnError(button, xhr);
            logger.groupEnd();
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
                logger.groupEnd();
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
                    infoLog(
                      "Found data-download-url attribute in slowDownloadButton (NMM)",
                      downloadUrl,
                    );
                    btnSuccess(button);
                    try {
                      document.location.href = downloadUrl;
                    } catch (_) {
                      window.location = downloadUrl;
                    }
                    logger.groupEnd();
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
                  infoLog(
                    "Using JSON parsed.url from NMM GET response",
                    parsed.url,
                  );
                  btnSuccess(button);
                  try {
                    document.location.href = parsed.url;
                  } catch (_) {
                    window.location = parsed.url;
                  }
                  logger.groupEnd();
                  return;
                }

                // JSON parse was skipped or failed try jMatch unescape + w. extraction
                try {
                  debugLog(
                    "NMM GET: attempting jMatch unescape + text-extractor fallback",
                  );
                  const body = String(data);
                  const unescaped =
                    typeof tryjMatchUnescape === "function"
                      ? tryjMatchUnescape(body)
                      : body.replace(/\\\//g, "/");

                  debugLog(
                    "NMM GET: unescaped body preview:",
                    unescaped.slice(0, 200),
                  );

                  // if unescaped is a plain URL
                  if (/^(https?:\/\/|nxm:\/\/)/i.test(unescaped.trim())) {
                    const url = unescaped.trim().replace(/&amp;/g, "&");
                    debugLog(
                      "NMM GET: unescaped content is direct URL; navigating to:",
                      url,
                    );
                    btnSuccess(button);
                    try {
                      document.location.href = url;
                    } catch (_) {
                      window.location = url;
                    }
                    logger.groupEnd();
                    return;
                  }

                  // try extractor on unescaped content first
                  let regexUrl = null;
                  try {
                    regexUrl = extractDownloadUrlTxt(unescaped);
                    debugLog(
                      "NMM GET: text-extractor matched URL on unescaped content:",
                      regexUrl,
                    );
                  } catch (e) {
                    debugLog(
                      "NMM GET: text-extractor threw on unescaped content",
                      e,
                    );
                  }

                  // fallback to extractor on original body
                  if (!regexUrl) {
                    try {
                      regexUrl = extractDownloadUrlTxt(body);
                      debugLog(
                        "NMM GET: text-extractor matched URL on original body:",
                        regexUrl,
                      );
                    } catch (e) {
                      debugLog(
                        "NMM GET: text-extractor threw on original body",
                        e,
                      );
                    }
                  }

                  if (regexUrl) {
                    infoLog(
                      "Using text-extracted URL from NMM GET response (after unescape fallback)",
                      regexUrl,
                    );
                    btnSuccess(button);
                    try {
                      document.location.href = regexUrl;
                    } catch (_) {
                      window.location = regexUrl;
                    }
                    logger.groupEnd();
                    return;
                  }

                  debugLog(
                    "NMM GET: unescape + text-extractor returned no URL",
                  );
                } catch (e) {
                  debugLog("NMM GET: unescape+extract fallback failed", e);
                }

                // fallback to call the POST GenerateDownloadUrl (same as manual)
                debugLog(
                  "NMM GET: no URL found after fallbacks; calling GenerateDownloadUrl POST for fid=" +
                    fileId,
                );
                ajaxRequest(postOptions);
              } catch (e) {
                btnError(button, e);
                logger.groupEnd();
              }
            },
            error(xhr) {
              btnError(button, xhr);
              logger.groupEnd();
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
      logger.groupEnd();
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

  function autoStartFileLink() {
    if (!/file_id=/.test(window.location.href)) return;
    debugLog(
      "autoStartFileLink detected file_id in URL - trying to auto-start",
    );
    const findInRoot = (root) => {
      if (!root) return null;
      try {
        const byId = (id) =>
          root.getElementById ? root.getElementById(id) : null;
        let btn = byId("slowDownloadButton") || byId("startDownloadButton");
        if (btn) return btn;

        const upsell = byId("upsell-cards");
        if (upsell) {
          const last = upsell.lastElementChild;
          if (last) {
            const b = last.querySelector && last.querySelector("button");
            return b || last;
          }
        }
        const dataEl =
          root.querySelector && root.querySelector("[data-download-url]");
        if (dataEl) return dataEl;

        const candidates = root.querySelectorAll
          ? Array.from(root.querySelectorAll("button, a"))
          : [];
        for (const el of candidates) {
          const text = (el.textContent || "").trim().replace(/\s+/g, " ");
          if (/\bSlow download\b/i.test(text)) return el;
        }
      } catch (e) {
        debugLog("autoStartFileLink: error while searching root", e);
      }
      return null;
    };

    const tryFind = () => {
      let button = findInRoot(document);
      if (!button) {
        const mf = document.querySelector("mod-file-download");
        if (mf && mf.shadowRoot) button = findInRoot(mf.shadowRoot);
      }
      return button;
    };

    let btn = tryFind();
    if (btn) {
      debugLog("autoStartFileLink: found button immediately", btn);
      try {
        clickListener.call(btn, null);
        closeOnDL();
      } catch (e) {
        debugLog("autoStartFileLink: click failed", e);
      }
      return;
    }

    let attempts = 0;
    const maxAttempts = 12;
    const interval = 250;
    const poll = setInterval(() => {
      attempts++;
      btn = tryFind();
      if (!btn) {
        const mf = document.querySelector("mod-file-download");
        if (mf && mf.shadowRoot) btn = findInRoot(mf.shadowRoot);
      }
      if (btn) {
        clearInterval(poll);
        debugLog(
          "autoStartFileLink: found button after polling (attempts=" +
            attempts +
            ")",
          btn,
        );
        try {
          clickListener.call(btn, null);
          closeOnDL();
        } catch (e) {
          debugLog("autoStartFileLink: click failed after poll", e);
        }
        return;
      }
      if (attempts >= maxAttempts) {
        clearInterval(poll);
        debugLog("autoStartFileLink: giving up after attempts=" + attempts);
      }
    }, interval);
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

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
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
          "http://www.w3.org/1999/xlink",
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

  // -------------------------------- Premium upsell/ads blocker --------------------------------
  const PREMIUM_HIDE_SELECTORS = [
    // IDs
    "#nonPremiumBanner",
    "#freeTrialBanner",
    "#ig-banner-container",

    // Partial class matches
    '[class*="ads-bottom"]',
    '[class*="ads-top"]',
    '[class*="to-premium"]',
    '[class*="from-premium"]',
    '[class*="premium"]',

    // Generic flex/space containers that match banners
    ".space-y-16 > .justify-center.items-center.flex",

    ".md\\:flex.py-2.bg-surface-low.border-stroke-subdued.border-b.gap-x-4.justify-center.items-center.hidden",
    ".py-2.bg-surface-low.border-stroke-subdued.border-y.gap-x-4.justify-center.items-center.flex",
  ];

  let premiumUpsellStyleEl = null;

  function buildPremiumHideCSS() {
    return PREMIUM_HIDE_SELECTORS.map(
      (sel) => `${sel}{display:none !important;}`,
    ).join("\n");
  }

  function enablePremiumUpsellBlocker() {
    try {
      if (premiumUpsellStyleEl) return;
      premiumUpsellStyleEl = document.createElement("style");
      premiumUpsellStyleEl.setAttribute("data-nnw-premium-blocker", "1");
      premiumUpsellStyleEl.textContent = buildPremiumHideCSS();
      (document.head || document.documentElement).appendChild(
        premiumUpsellStyleEl,
      );
      debugLog("Premium upsell/ads blocker enabled");
    } catch (e) {
      debugLog("Failed to enable premium upsell blocker", e);
    }
  }
  function disablePremiumUpsellBlocker() {
    try {
      if (premiumUpsellStyleEl && premiumUpsellStyleEl.parentNode) {
        premiumUpsellStyleEl.parentNode.removeChild(premiumUpsellStyleEl);
      }
      premiumUpsellStyleEl = null;
      debugLog("Premium upsell/ads blocker disabled");
    } catch (e) {
      debugLog("Failed to disable premium upsell blocker", e);
    }
  }

  function applyPremiumUpsellSetting() {
    if (config.hidePremiumUpsells) enablePremiumUpsellBlocker();
    else disablePremiumUpsellBlocker();
  }

  // -------------------------------- UI --------------------------------
  const SETTING_UI = {
    autoCloseTab: {
      name: "Auto-Close on file_id= tabs after download starts",
      description:
        "Automatically close tab after download starts on file_id= URLs\nPleae change the Auto-Close Tab Delay if it is closing too soon",
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
    errorSoundURL: {
      name: "Error Sound URL",
      description: "Custom URL for the error sound",
    },

    hidePremiumUpsells: {
      name: "Hide Premium Upsells & misc Ads (experimental)",
      description:
        "Hides Nexus premium upsell banners, trial banners, and common ad containers across the site",
    },
  };

  const STYLES = {
    button: `position:fixed;bottom:20px;right:20px;background:#2f2f2f;color:#fff;padding:10px 15px;border-radius:4px;cursor:pointer;z-index:9999;font-family:'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif;font-size:14px;border:none;`,
    modal: `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#2f2f2f;color:#dadada;padding:25px;border-radius:4px;z-index:10000;min-width:300px;max-width:90%;max-height:90vh;overflow-y:auto;font-family:'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif;`,
    backdrop: `position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:9999;`,
    section: `background:#363636;padding:15px;border-radius:4px;margin-bottom:15px;`,
    sectionHeader: `color:#da8e35;margin:0 0 10px 0;font-size:16px;font-weight:500;`,
    input: `background:#2f2f2f;border:1px solid #444;color:#dadada;border-radius:3px;padding:5px;`,
    btn: {
      primary: `padding:8px 15px;border:none;background:#da8e35;color:white;border-radius:3px;cursor:pointer;`,
      secondary: `padding:8px 15px;border:1px solid #da8e35;background:transparent;color:#da8e35;border-radius:3px;cursor:pointer;`,
      advanced: `padding:4px 8px;background:transparent;color:#666;border:none;cursor:pointer;`,
      closeX: `position:absolute;top:10px;right:10px;background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;padding:5px;`,
    },
  };

  function createSettingsUI() {
    const ID = "nnw-settings-toggle";
    if (document.getElementById(ID)) return;

    const btn = document.createElement("div");
    btn.id = ID;
    btn.innerHTML = "NexusNoWait++ ⚙️";
    btn.style.cssText = STYLES.button;
    btn.onmouseover = () => (btn.style.transform = "translateY(-2px)");
    btn.onmouseout = () => (btn.style.transform = "translateY(0)");
    btn.onclick = () => {
      if (activeModal) {
        closeSettingsModal();
      } else showSettingsModal();
    };

    // attach to document.body
    document.body.appendChild(btn);

    /*
     * watch for removal and put it back instantly
     * for some fucking reason this only seems to happen on firefox recently even though it seems to be a react thing
     * just what the fuck?
     */
    const observer = new MutationObserver((mutations) => {
      let removed = false;
      for (const m of mutations) {
        if (m.removedNodes) {
          for (const n of m.removedNodes) {
            if (n.id === ID) {
              removed = true;
              break;
            }
          }
        }
      }
      if (removed) {
        debugLog("Settings button wiped by site. Resurrecting...");
        document.body.appendChild(btn);
      }
    });

    observer.observe(document.body, { childList: true });
  }

  function generateSettingsHTML() {
    const normalBooleanSettings = Object.entries(SETTING_UI)
      .filter(([k]) => typeof config[k] === "boolean" && k !== "debug")
      .map(([key, { name, description }]) => {
        let html = `
        <div style="margin-bottom:10px;">
          <label title="${description}" style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" ${
              config[key] ? "checked" : ""
            } data-setting="${key}">
            <span>${name}</span>
          </label>
        </div>`;

        if (key === "playErrorSound") {
          const displayStyle = config.playErrorSound ? "block" : "none";
          html += `
            <div id="errorSoundUrlContainer" style="margin-bottom:10px;margin-left:24px;display:${displayStyle};">
               <label title="${SETTING_UI.errorSoundURL.description}" style="display:flex;flex-direction:column;gap:4px;">
                 <span style="font-size:0.9em;color:#aaa;">${SETTING_UI.errorSoundURL.name}:</span>
                 <input type="text" value="${config.errorSoundURL}" data-setting="errorSoundURL" style="${STYLES.input}width:95%;">
               </label>
            </div>
          `;
        }
        return html;
      })
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
      <button id="closeSettingsX" style="${STYLES.btn.closeX}" title="Close">✕</button>
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
  let activeBackdrop = null;
  let settingsChanged = false;

  function closeSettingsModal() {
    if (activeModal) activeModal.remove();
    if (activeBackdrop) activeBackdrop.remove();
    document.removeEventListener("keydown", onSettingsKeyDown);
    activeModal = null;
    activeBackdrop = null;
    if (settingsChanged) location.reload();
  }

  function onSettingsKeyDown(e) {
    if (e.key === "Escape") {
      closeSettingsModal();
    }
  }

  function showSettingsModal() {
    if (activeModal) closeSettingsModal();
    settingsChanged = false;

    // create backdrop for settings modal
    const backdrop = document.createElement("div");
    backdrop.style.cssText = STYLES.backdrop;
    backdrop.onclick = (e) => {
      // close if clicking on the backdrop
      if (e.target === backdrop) closeSettingsModal();
    };

    document.body.appendChild(backdrop);
    activeBackdrop = backdrop;

    const modal = document.createElement("div");
    modal.style.cssText = STYLES.modal;
    modal.innerHTML = generateSettingsHTML();

    function updateSetting(element) {
      const setting = element.getAttribute("data-setting");
      const value =
        element.type === "checkbox"
          ? element.checked
          : element.type === "number"
            ? parseInt(element.value, 10)
            : element.value;

      if (typeof value === "number" && isNaN(value)) {
        element.value = config[setting];
        return;
      }
      if (config[setting] !== value) {
        settingsChanged = true;
        window.nexusConfig.setFeature(setting, value);
      }

      if (setting === "playErrorSound") {
        const container = modal.querySelector("#errorSoundUrlContainer");
        if (container) {
          container.style.display = element.checked ? "block" : "none";
        }
      }
    }

    modal.addEventListener("change", (e) => {
      if (e.target.hasAttribute("data-setting")) updateSetting(e.target);
    });
    modal.addEventListener("input", (e) => {
      if (
        (e.target.type === "number" || e.target.type === "text") &&
        e.target.hasAttribute("data-setting")
      )
        updateSetting(e.target);
    });

    modal.querySelector("#closeSettingsX").onclick = () => {
      closeSettingsModal();
    };
    modal.querySelector("#closeSettings").onclick = () => {
      closeSettingsModal();
    };
    modal.querySelector("#resetSettings").onclick = () => {
      settingsChanged = true;
      window.nexusConfig.reset();
      saveSettings(config);
      closeSettingsModal();
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

    // listen for escape key
    document.addEventListener("keydown", onSettingsKeyDown);
  }

  function setupDebugMode() {
    // Stop monkeypatching console; we use logger and debugLog to surface alerts when config.debug is enabled.
    if (config.debug) {
      infoLog("Debug mode enabled (alerts will be shown for debug logs).");
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
    applyPremiumUpsellSetting();
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
    mainObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
    debugLog("Started mutation observer");
    window.addEventListener("unload", () => {
      mainObserver.disconnect();
      debugLog("Unload: disconnected observer");
    });
  }
})();
