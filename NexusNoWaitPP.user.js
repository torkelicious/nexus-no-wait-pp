// ==UserScript==
// @name        Nexus No Wait ++ [devel]
// @description NNW++ development branch
// @version     latest
// @include     https://*.nexusmods.com/*
// @run-at      document-idle
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_xmlhttpRequest
// @grant       GM_info
// @connect     nexusmods.com
// ==/UserScript==

// this is the EXPERIMENTAL development branch
// supposed to be a full refactor of the main script!
// VERY UNFINISHED!

(function () {
  "use strict";

  // config
  const CONFIG_KEY = "nexusNoWaitPPConfig";
  const DEFAULTS = {
    AutoStartDownload: true,
    AutoCloseTab: true,
    SkipRequirements: true,
    RefreshOnError: false,
    PlayErrorSound: true,
    ErrorSoundUrl:
      "https://github.com/torkelicious/nexus-no-wait-pp/raw/refs/heads/main/errorsound.mp3",
    HidePremiumUpsells: false,
    CloseTabDelay: 2000,
    RequestTimeout: 30000,
  };
  function loadConfig() {
    try {
      const raw =
        typeof GM_getValue === "function"
          ? GM_getValue(CONFIG_KEY, null)
          : null;
      return raw
        ? { ...DEFAULTS, ...(typeof raw === "string" ? JSON.parse(raw) : raw) }
        : DEFAULTS;
    } catch (e) {
      return DEFAULTS;
    }
  }
  const cfg = loadConfig();

  // logger
  // TODO: make logging more thorough like in the main branch
  // also make btn error messages meaningful...!!!
  const Logger = (function () {
    function prefix() {
      return `[NexusNoWait++ v${GM_info.script.version}]`;
    }
    function format(level, args) {
      const items = Array.from(args);
      items.unshift(prefix());
      items.push(`\n at:(${location.href})`);
      return items;
    }
    return {
      debug(...args) {
        console.debug(...format("debug", args));
      },
      info(...args) {
        console.info(...format("info", args));
      },
      warn(...args) {
        console.warn(...format("warn", args));
      },
      error(...args) {
        console.error(...format("error", args));
      },
    };
  })();

  // helpers for NMM nxm building
  // only bs that seems reliable at the moment...
  function getCurrentPathSegment(index) {
    return window.location.pathname.split("/")[index] || null;
  }
  function extractParamsFromText(text, params = {}) {
    const s = String(text || "");
    const key = s.match(/(?:md5|key)=([^&"']+)/)?.[1];
    const exp = s.match(/(?:expires|exp)=([^&"']+)/)?.[1];
    const user = s.match(/user_id=([^&"']+)/)?.[1];
    const fid = s.match(/(?:fid|file_id|id)=([^&"']+)/)?.[1];
    if (key) params.key = key;
    if (exp) params.expires = exp;
    if (user) params.user_id = user;
    if (fid && !params.fileId) params.fileId = fid;
    params.game = params.game || getCurrentPathSegment(1);
    params.modId = params.modId || getCurrentPathSegment(3);
    return params;
  }
  function makeNxMUrl(params = {}) {
    const needed = ["game", "modId", "fileId", "key", "expires", "user_id"];
    if (needed.some((k) => !params[k])) return null;
    return `nxm://${params.game}/mods/${params.modId}/files/${params.fileId}?key=${params.key}&expires=${params.expires}&user_id=${params.user_id}`;
  }

  function extractUrl(text) {
    if (!text) return null;
    const s = String(text);
    try {
      const j = JSON.parse(s);
      if (j && j.url) {
        return { url: j.url.replace(/&amp;/g, "&"), source: "json-url" };
      }
    } catch (_) {}
    const m = s.match(/id=["']dl_link["'][^>]*value=["']([^"']+)["']/i);
    if (m) {
      return { url: m[1].replace(/&amp;/g, "&"), source: "dl_link-value" };
    }
    return null;
  }

  function getGameId() {
    const s = document.getElementById("section");
    return s?.dataset?.gameId || "";
  }

  // GenerateDownloadUrl (POST)
  function getGenDownloadUrl(fileId, gameId) {
    if (!fileId) return Promise.resolve({ url: null, error: "Missing fileId" });
    const endpoint = "/Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl";
    const body = `fid=${encodeURIComponent(fileId)}&game_id=${encodeURIComponent(gameId || "")}`;
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: endpoint,
        data: body,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          Origin: "https://www.nexusmods.com",
          Referer: location.href,
        },
        timeout: cfg.RequestTimeout,
        onload(res) {
          const txt = res.response || res.responseText || "";
          const extracted = extractUrl(txt);
          if (extracted) {
            Logger.info("Manual POST: extracted URL via", extracted.source);
            resolve({ url: extracted.url, source: extracted.source });
          } else {
            Logger.warn("Manual POST: no URL extracted");
            resolve({ url: null, error: "No URL in response" });
          }
        },
        onerror() {
          resolve({ url: null, error: "Request failed" });
        },
        ontimeout() {
          resolve({ url: null, error: "Timeout" });
        },
      });
    });
  }

  // NMM: GET DownloadPopUp, extract URL, if https build nxm
  async function getNMMDownloadUrl(fileId, gameId) {
    if (!fileId) return null;

    const popupEndpoint = `/Core/Libs/Common/Widgets/DownloadPopUp?id=${encodeURIComponent(fileId)}&game_id=${encodeURIComponent(gameId || "")}`;
    let text = "";
    await new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: popupEndpoint,
        headers: { "X-Requested-With": "XMLHttpRequest" },
        onload(res) {
          text = res.response || res.responseText || "";
          resolve();
        },
        onerror() {
          resolve();
        },
        ontimeout() {
          resolve();
        },
      });
    });

    if (!text) {
      Logger.warn("NMM GET: empty response");
      return null;
    }

    const extracted = extractUrl(text);
    if (!extracted) {
      Logger.warn("NMM GET: no URL extracted");
      return null;
    }

    if (/^nxm:\/\//i.test(extracted.url)) {
      Logger.info("NMM GET: using extracted nxm");
      return extracted.url;
    }
    if (/^https?:\/\//i.test(extracted.url)) {
      const params = extractParamsFromText(extracted.url, {
        fileId,
        modId: getCurrentPathSegment(3),
        game: getCurrentPathSegment(1),
      });
      const nxm = makeNxMUrl(params);
      if (nxm) {
        Logger.info("NMM GET: built nxm from tokens");
        return nxm;
      }
      Logger.info("NMM GET: using extracted https (no nxm built)");
      return extracted.url;
    }

    Logger.warn("NMM GET: unknown URL type");
    return null;
  }

  // button state
  function setButtonState(button, state, message) {
    try {
      const span = button.querySelector("span.flex-label");
      if (span) {
        span.innerText =
          state === "waiting"
            ? "Please Wait..."
            : state === "downloading"
              ? "Downloading!"
              : message || "Error";
      }
      button.style.color =
        state === "waiting"
          ? "orange"
          : state === "downloading"
            ? "green"
            : "red";
    } catch (e) {}
  }

  // click interceptor
  function attachClickInterceptor() {
    document.body.addEventListener(
      "click",
      async function (e) {
        const el = e.target.closest("a,button");
        if (!el) return;

        const href = el.href || el.getAttribute("href") || "";
        let fileId = null;
        try {
          const u = new URL(href, location.href);
          fileId = u.searchParams.get("file_id") || u.searchParams.get("id");
        } catch (_) {}
        if (!fileId && el.dataset) fileId = el.dataset.fileid || el.dataset.id;
        if (!fileId && !/slow download/i.test(el.textContent || "")) return;

        const isNMM =
          href.includes("nmm=1") ||
          href.includes("&nmm") ||
          el.closest("#action-nmm") !== null;
        e.preventDefault();
        e.stopImmediatePropagation();

        if (!fileId) {
          const p = new URLSearchParams(location.search);
          fileId = p.get("file_id") || p.get("id");
        }
        if (!fileId) return;

        setButtonState(el, "waiting");
        Logger.debug("Intercepted click: fileId", fileId, "isNMM", isNMM);

        if (isNMM) {
          const nmmUrl = await getNMMDownloadUrl(fileId, getGameId());
          if (!nmmUrl) {
            setButtonState(el, "error", "Failed to get URL");
            return;
          }
          Logger.info(
            "NMM click: final URL type",
            nmmUrl.startsWith("nxm://") ? "nxm" : "https",
          );
          setButtonState(el, "downloading");
          location.assign(nmmUrl);
          if (cfg.AutoCloseTab)
            setTimeout(() => window.close(), cfg.CloseTabDelay);
          return;
        }

        const result = await getGenDownloadUrl(fileId, getGameId());
        if (!result.url) {
          setButtonState(el, "error", result.error || "Unknown error");
          return;
        }
        Logger.info(
          "Manual click: final URL type",
          result.url.startsWith("https://") ? "https" : "other",
        );
        setButtonState(el, "downloading");
        location.assign(result.url);
        if (cfg.AutoCloseTab)
          setTimeout(() => window.close(), cfg.CloseTabDelay);
      },
      true,
    );
  }

  // skip requirements probably obsolete but good to have i guess?
  function skipRequirements() {
    if (location.href.includes("tab=requirements")) {
      Logger.info("Skipped requirements tab");
      location.replace(location.href.replace("tab=requirements", "tab=files"));
    }
  }

  // auto-start on file_id URLs
  async function autoStartDownload() {
    if (!cfg.AutoStartDownload) return;
    const p = new URLSearchParams(location.search);
    const fid = p.get("file_id") || p.get("id");
    if (!fid) return;
    const isNMM = p.has("nmm") || p.get("nmm") === "1";
    Logger.debug("Auto-start: fileId", fid, "isNMM", isNMM);
    await new Promise((r) => setTimeout(r, 200));
    if (isNMM) {
      const nmmUrl = await getNMMDownloadUrl(fid, getGameId());
      if (nmmUrl) {
        Logger.info(
          "Auto NMM: final URL type",
          nmmUrl.startsWith("nxm://") ? "nxm" : "https",
        );
        location.assign(nmmUrl);
      }
      if (cfg.AutoCloseTab) setTimeout(() => window.close(), cfg.CloseTabDelay);
      return;
    }
    const result = await getGenDownloadUrl(fid, getGameId());
    if (result.url) {
      Logger.info(
        "Auto manual: final URL type",
        result.url.startsWith("https://") ? "https" : "other",
      );
      location.assign(result.url);
    }
    if (cfg.AutoCloseTab) setTimeout(() => window.close(), cfg.CloseTabDelay);
  }

  attachClickInterceptor();
  skipRequirements();
  autoStartDownload();
  Logger.debug("NNW++ initiated");
})();
