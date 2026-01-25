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
// @grant       GM_addStyle
// @connect     nexusmods.com
// @connect     raw.githubusercontent.com
// ==/UserScript==

// this is the EXPERIMENTAL development branch
// supposed to be a full refactor of the main script
// UNFINISHED !!!

(function () {
  "use strict";

  // Config
  const CONFIG_KEY = "NexusNoWaitPP";
  const DEFAULTS = {
    AutoStartDownload: true,
    AutoCloseTab: true,
    SkipRequirements: true,
    ShowAlertsOnError: true,
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
  let cfg = loadConfig();

  const Logger = (() => {
    const prefix = () => `[NexusNoWait++ v${GM_info.script.version}]`;
    const format = (args) => {
      const items = Array.from(args);
      items.unshift(prefix());
      items.push(`\n at:(${location.href})`);
      return items;
    };
    const log =
      (level) =>
      (...args) =>
        console[level](...format(args));
    return {
      debug: log("debug"),
      info: log("info"),
      warn: log("warn"),
      error: log("error"),
    };
  })();

  let errorAudioPlayer = null;
  function setupAudio() {
    // audio preloading
    if (!cfg.PlayErrorSound || !cfg.ErrorSoundUrl) return;
    errorAudioPlayer = new Audio(cfg.ErrorSoundUrl);
    errorAudioPlayer.preload = "auto";
    errorAudioPlayer.load();
  }

  function playErrorSound() {
    if (errorAudioPlayer) {
      errorAudioPlayer.currentTime = 0;
      errorAudioPlayer
        .play()
        .catch((e) => Logger.warn("Error playing sound:", e));
    }
  }

  // NXM URL helpers
  function getURLPathSegment(index) {
    return window.location.pathname.split("/")[index] || null;
  }
  function parseNXMParamsFromURL(text, params = {}) {
    const inputText = String(text || "");
    const mappings = [
      { regex: /(?:md5|key)=([^&"']+)/, key: "key" },
      { regex: /(?:expires|exp)=([^&"']+)/, key: "expires" },
      { regex: /user_id=([^&"']+)/, key: "user_id" },
      {
        regex: /(?:file_id)=([^&"']+)/,
        key: "fileId",
        condition: () => !params.fileId,
      },
    ];
    for (const { regex, key, condition = () => true } of mappings) {
      const match = inputText.match(regex)?.[1];
      if (match && condition()) params[key] = match;
    }
    params.game = params.game || getURLPathSegment(1);
    params.modId = params.modId || getURLPathSegment(3);
    return params;
  }
  function buildNXMUrl(params = {}) {
    const needed = ["game", "modId", "fileId", "key", "expires", "user_id"];
    if (needed.some((k) => !params[k])) return null;
    return `nxm://${params.game}/mods/${params.modId}/files/${params.fileId}?key=${params.key}&expires=${params.expires}&user_id=${params.user_id}`;
  }

  function parseDownloadURLFromResponse(text) {
    if (!text) return null;
    const inputText = String(text);
    try {
      const json = JSON.parse(inputText);
      if (json && json.url) {
        return { url: json.url.replace(/&amp;/g, "&"), source: "json-url" };
      }
    } catch (_) {}
    const match = inputText.match(
      /id=["']dl_link["'][^>]*value=["']([^"']+)["']/i,
    );
    if (match) {
      return { url: match[1].replace(/&amp;/g, "&"), source: "dl_link-value" };
    }
    return null;
  }

  function getGameId() {
    const sectionElement = document.getElementById("section");
    return sectionElement?.dataset?.gameId || "";
  }

  // POST download URL
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
        onload(response) {
          const responseText = response.response || response.responseText || "";
          const extracted = parseDownloadURLFromResponse(responseText);
          if (extracted) {
            Logger.info("Manual POST: extracted URL via", extracted.source);
            resolve({ url: extracted.url, source: extracted.source });
          } else {
            Logger.warn("Manual POST: no URL extracted");
            resolve({
              url: null,
              error: "No URL in response\n(Are you logged in?)",
            });
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

  // NMM download URL extraction
  async function getNMMDownloadUrl(fileId, gameId) {
    if (!fileId) return null;

    const popupEndpoint = `/Core/Libs/Common/Widgets/DownloadPopUp?id=${encodeURIComponent(fileId)}&game_id=${encodeURIComponent(gameId || "")}`;
    let responseText = "";
    await new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: popupEndpoint,
        headers: { "X-Requested-With": "XMLHttpRequest" },
        onload(response) {
          responseText = response.response || response.responseText || "";
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

    if (!responseText) {
      Logger.warn("NMM GET: empty response");
      return null;
    }

    const extracted = parseDownloadURLFromResponse(responseText);
    if (!extracted) {
      Logger.warn("NMM GET: no URL extracted");
      return null;
    }

    if (/^nxm:\/\//i.test(extracted.url)) {
      Logger.info("NMM GET: using extracted nxm");
      return extracted.url;
    }
    if (/^https?:\/\//i.test(extracted.url)) {
      const params = parseNXMParamsFromURL(extracted.url, {
        fileId,
        modId: getURLPathSegment(3),
        game: getURLPathSegment(1),
      });
      const nxm = buildNXMUrl(params);
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

  function setButtonState(button, state, message) {
    try {
      const textElement =
        button.querySelector("span.flex-label, span") || button;
      const text =
        state === "waiting"
          ? "Please Wait..."
          : state === "downloading"
            ? "Downloading!"
            : message || "Error";
      textElement.innerText = text;
      button.style.color =
        state === "waiting"
          ? "orange"
          : state === "downloading"
            ? "green"
            : "red";
    } catch (e) {}
  }

  async function getDownloadResult(isNMM, fileId, gameId) {
    if (isNMM) {
      const url = await getNMMDownloadUrl(fileId, gameId);
      return url ? { url } : { error: "Failed to get URL" };
    }
    const result = await getGenDownloadUrl(fileId, gameId);
    return result.url
      ? { url: result.url }
      : { error: result.error || "Unknown error" };
  }

  function attachClickInterceptor() {
    async function handleDownload(btn, fileId, isNMM) {
      setButtonState(btn, "waiting");
      Logger.debug("fileId", fileId, "isNMM", isNMM);
      const { url, error } = await getDownloadResult(
        isNMM,
        fileId,
        getGameId(),
      );
      if (error) {
        setButtonState(btn, "error", error);
        if (cfg.PlayErrorSound) playErrorSound();
        if (cfg.ShowAlertsOnError) alert(`Download error: ${error}`);
        return;
      }
      setButtonState(btn, "downloading");
      location.assign(url);
    }

    document.body.addEventListener(
      "click",
      async function (event) {
        const element = event.target.closest("a,button");
        if (!element) return;

        const linkHref = element.href || element.getAttribute("href") || "";
        if (!linkHref) return;
        let fileId = null;
        try {
          const url = new URL(linkHref, location.href);
          fileId =
            url.searchParams.get("file_id") || url.searchParams.get("id");
        } catch (_) {}
        if (!fileId) return;

        const hasRequirements =
          linkHref.includes("ModRequirementsPopUp") ||
          linkHref.includes("tab=requirements");
        const isNMM =
          linkHref.includes("nmm=1") ||
          linkHref.includes("&nmm") ||
          element.closest("#action-nmm") !== null;

        // If SkipRequirements is enabled and this is a requirements popup button, trigger download directly
        if (hasRequirements && cfg.SkipRequirements) {
          event.preventDefault();
          event.stopImmediatePropagation();
          handleDownload(element, fileId, isNMM);
          return;
        }

        // If requirements are present and skip is not enabled, let the popup/tab open as normal
        if (hasRequirements && !cfg.SkipRequirements) {
          return;
        }

        // Otherwise, handle as normal download
        event.preventDefault();
        event.stopImmediatePropagation();
        handleDownload(element, fileId, isNMM);
      },
      true,
    );

    // Intercept "Slow download" button on file_id pages
    if (location.search.includes("file_id")) {
      const setupSlowDownloadIntercept = () => {
        const modFileDownload = document.querySelector("mod-file-download");
        if (modFileDownload?.shadowRoot) {
          const slowDownloadBtn = modFileDownload.shadowRoot.querySelector(
            "#upsell-cards > div.flex.flex-col.justify-between.gap-y-6.rounded-lg.bg-surface-translucent-low.p-6 > button",
          );
          if (slowDownloadBtn) {
            slowDownloadBtn.addEventListener("click", async (event) => {
              event.preventDefault();
              event.stopImmediatePropagation();
              const params = new URLSearchParams(location.search);
              const fileId = params.get("file_id");
              if (!fileId) return;
              const isNMM = params.has("nmm") || params.get("nmm") === "1";
              Logger.debug(
                "Slow download intercept: fileId",
                fileId,
                "isNMM",
                isNMM,
              );
              setButtonState(slowDownloadBtn, "waiting");
              const { url } = await getDownloadResult(
                isNMM,
                fileId,
                getGameId(),
              );
              if (url) {
                setButtonState(slowDownloadBtn, "downloading");
                Logger.info(
                  `Slow download ${isNMM ? "NMM" : "manual"}: starting download`,
                );
                location.assign(url);
              }
            });
          }
        }
      };

      setupSlowDownloadIntercept();
      const observer = new MutationObserver(() => {
        setupSlowDownloadIntercept();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function interceptRequirementsTab() {
    document.body.addEventListener(
      "click",
      function (event) {
        const linkElement = event.target.closest("a[href*='tab=requirements']");
        if (!linkElement) return;
        if (!cfg.SkipRequirements) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const linkHref =
          linkElement.href || linkElement.getAttribute("href") || "";
        location.replace(linkHref.replace("tab=requirements", "tab=files"));
      },
      true,
    );
  }

  async function autoStartDownload() {
    if (!cfg.AutoStartDownload) return;
    const params = new URLSearchParams(location.search);
    const fileId = params.get("file_id");
    if (!fileId) return;
    const isNMM = params.has("nmm") || params.get("nmm") === "1";
    Logger.debug("Auto-start: fileId", fileId, "isNMM", isNMM);
    await new Promise((r) => setTimeout(r, 200));
    const { url } = await getDownloadResult(isNMM, fileId, getGameId());
    if (url) {
      Logger.info(
        `Auto ${isNMM ? "NMM" : "manual"}: final URL type`,
        url.startsWith("nxm://")
          ? "nxm"
          : url.startsWith("https://")
            ? "https"
            : "other",
      );
      location.assign(url);
      if (cfg.AutoCloseTab) setTimeout(() => window.close(), cfg.CloseTabDelay);
    }
  }

  function upsellBlocker() {
    if (!cfg.HidePremiumUpsells) return;
    const elementsToHideSelectors = [
      // IDs
      "#nonPremiumBanner",
      "#freeTrialBanner",
      "#ig-banner-container",
      "#rj-vortex",
      // broad class matches for dynamic content
      '[class*="ads-bottom"]',
      '[class*="ads-top"]',
      '[class*="to-premium"]',
      '[class*="from-premium"]',
      '[class*="premium"]',
      // specific page elements
      "#mainContent > div.ads-holder.clearfix.ads-top",
      "#mainContent > div.ads-holder.clearfix.ads-bottom",
      "#mainContent > div > div.relative.next-container > div > section.flex.items-center.justify-center > div",
      "#mainContent > div > div.relative.next-container > div > a",
      "#headlessui-menu-items-_r_ap_ > div.flex.flex-col.gap-y-4.px-3.py-2 > div.hidden.md\\:block",
      "#head > div.rj-right-tray.rj-profile-tray.rj-open > ul > li.user-profile-menu-section-top > a",
      "#mainContent > div.flex.items-center.justify-center.gap-x-4.border-y.border-stroke-subdued.bg-surface-low.py-2",
      "#mainContent > div.hidden.items-center.justify-center.gap-x-4.border-b.border-stroke-subdued.bg-surface-low.py-2.md\\:flex",
      "#mainContent > div.relative > div.relative.next-container.pb-20 > div.space-y-16 > div.relative.overflow-hidden.rounded-lg.border-2.border-\[\#FCD23F\]",
      "#mainContent > div.relative > div.relative.next-container.pb-20 > div.mb-6.w-full.space-y-6.border-b.border-stroke-weak.pt-4.pb-6.sm\\:mb-0.sm\\:border-none.sm\\:pb-8 > section > div.flex.flex-col.gap-2.rounded-sm.bg-surface-translucent-low.p-2.5.backdrop-blur-xs.xs\\:w-fit.xs\\:max-w-sm.order-4.h-fit.w-full",
      "#filters-panel > div.mt-4.hidden.rounded-lg.border.border-creator-subdued.bg-creator-weak.bg-cover.p-4",
    ];
    // hide all selectors
    GM_addStyle(
      elementsToHideSelectors
        .map((selector) => `${selector}{display:none!important}`)
        .join("\n"),
    );

    // hide upsells in shadow root
    const modFileDownloadElement = document.querySelector("mod-file-download");
    if (modFileDownloadElement?.shadowRoot) {
      const shadowStyle = document.createElement("style");
      shadowStyle.textContent =
        "#upsell-cards > div.relative.flex.flex-col.justify-between.gap-y-6.rounded-lg.border.bg-gradient-to-t.from-premium-weak.from-25\\%.to-premium-900.to-75\\%.p-6.sm\\:order-last.border-premium-100.border-premium-moderate{display:none!important}";
      modFileDownloadElement.shadowRoot.appendChild(shadowStyle);
    }
    // Hide premium banner inside freetrialbanner shadow root
    const freeTrialBannerElement = document.querySelector("free-trial-banner");
    if (freeTrialBannerElement?.shadowRoot) {
      const premiumBanner = freeTrialBannerElement.shadowRoot.querySelector(
        "div.relative.flex.justify-between.gap-3.bg-premium-weak.px-3.py-2.5",
      );
      if (premiumBanner) premiumBanner.style.display = "none";
    }
  }

  function archivedFileHandler() {}

  function main() {
    setupAudio();
    attachClickInterceptor();
    interceptRequirementsTab();
    autoStartDownload();
    upsellBlocker();
    SettingsUI();
    Logger.debug("NNW++ initiated");
  }

  function SettingsUI() {
    const SETTING_UI = [
      {
        key: "AutoStartDownload",
        label: "Auto Start Download on file_id= URLs",
        type: "bool",
        description:
          "Automatically start downloads when visiting file download pages (URLs containing file_id=)",
      },
      {
        key: "AutoCloseTab",
        label: "Auto-Close Tab After Automatic Download ",
        type: "bool",
        description:
          "Automatically close the tab after a download starts on file download pages",
        showIf: () => cfg.AutoStartDownload,
      },
      {
        key: "SkipRequirements",
        label: "Skip Requirements PopUp/Tab",
        type: "bool",
        description:
          "Skip the requirements popup/page and proceed directly to download",
      },
      {
        key: "ShowAlertsOnError",
        label: "Show Alert Messages on Errors",
        type: "bool",
        description: "Display error messages as browser popup alerts",
      },
      {
        key: "PlayErrorSound",
        label: "Play Error Sound",
        type: "bool",
        description: "Play an audio alert when download errors occur",
      },

      {
        key: "HidePremiumUpsells",
        label: "Hide Premium Upsells & misc Annoyances (experimental)",
        type: "bool",
        description:
          "Hide premium upgrade banners, trial offers, and other Annoyances on the site (experimental)\n slow and buggy, you are probably better off using an adblocker.",
      },
      {
        key: "RequestTimeout",
        label: "Request Timeout",
        type: "number",
        description:
          "Maximum time to wait for server responses before timing out (in milliseconds)",
      },
      {
        key: "CloseTabDelay",
        label: "Auto-Close Tab Delay",
        type: "number",
        description:
          "Delay before automatically closing the tab after download starts (in milliseconds)",
        showIf: () => cfg.AutoCloseTab,
      },
      {
        key: "ErrorSoundUrl",
        label: "Error Sound URL",
        type: "text",
        description: "URL of the custom sound file to play for error alerts",
        showIf: () => cfg.PlayErrorSound,
      },
    ];
    const STYLES = {
      btn: "position:fixed;bottom:20px;right:20px;background:#2f2f2f;color:#fff;padding:10px 15px;border-radius:4px;cursor:pointer;z-index:9999;font-family:'Inter','Helvetica Neue', Helvetica, Arial, sans-serif;font-size:14px;border:none;",
      modal:
        "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#2f2f2f;color:#dadada;padding:25px;border-radius:4px;z-index:10000;min-width:300px;max-width:90%;max-height:90vh;overflow-y:auto;font-family:'Inter','Helvetica Neue', Helvetica, Arial, sans-serif;",
      backdrop:
        "position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:9999;",
      section:
        "background:#363636;padding:15px;border-radius:4px;margin-bottom:15px;",
      sectionHeader:
        "color:#da8e35;margin:0 0 10px 0;font-size:16px;font-weight:500;",
      input:
        "background:#2f2f2f;border:1px solid #444;color:#dadada;border-radius:3px;padding:5px;",
      row: "margin-bottom:10px;",
      label: "display:flex;align-items:center;gap:8px;",
      btnObj: {
        primary:
          "padding:8px 15px;border:none;background:#da8e35;color:white;border-radius:3px;cursor:pointer;",
        secondary:
          "padding:8px 15px;border:1px solid #da8e35;background:transparent;color:#da8e35;border-radius:3px;cursor:pointer;",
        advanced:
          "padding:4px 8px;background:transparent;color:#666;border:none;cursor:pointer;",
        closeX:
          "position:absolute;top:10px;right:10px;background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;padding:5px;",
      },
    };
    function save() {
      try {
        GM_setValue(CONFIG_KEY, JSON.stringify(cfg));
      } catch (e) {}
    }
    let activeModal = null;
    let activeBackdrop = null;
    function showSettingsModal() {
      cfg = loadConfig();
      if (activeModal) activeModal.remove();
      if (activeBackdrop) activeBackdrop.remove();

      const backdrop = document.createElement("div");
      backdrop.style.cssText = STYLES.backdrop;
      backdrop.addEventListener("click", closeModal);
      document.body.appendChild(backdrop);
      activeBackdrop = backdrop;

      const modal = document.createElement("div");
      modal.style.cssText = STYLES.modal;

      const build = (setting) => {
        const shouldShow = !setting.showIf || setting.showIf();
        if (setting.type === "bool")
          return `<div style="${STYLES.row};display:${shouldShow ? "block" : "none"}"><label title="${setting.description}" style="${STYLES.label}"><input type="checkbox" data-setting="${setting.key}" ${cfg[setting.key] ? "checked" : ""}><span>${setting.label}</span></label></div>`;
        if (setting.type === "number") {
          const step = setting.key === "CloseTabDelay" ? 100 : 1;
          return `<div style="${STYLES.row};display:${shouldShow ? "block" : "none"}"><label title="${setting.description}" style="${STYLES.label}"><span>${setting.label}:</span><input type="number" value="${cfg[setting.key]}" min="0" step="${step}" data-setting="${setting.key}" style="${STYLES.input};width:120px;"></label></div>`;
        }
        if (setting.type === "text")
          return `<div style="${STYLES.row};display:${shouldShow ? "block" : "none"}"><label title="${setting.description}" style="${STYLES.label}"><span style="font-size:0.9em;color:#aaa;">${setting.label}:</span><input type="text" value="${cfg[setting.key]}" data-setting="${setting.key}" style="${STYLES.input};width:95%;"></label></div>`;
        return "";
      };

      const features = SETTING_UI.filter(
        (u) =>
          (u.type === "bool" || u.type === "text") &&
          u.key !== "RefreshOnError",
      )
        .map(build)
        .join("");
      const timing = SETTING_UI.filter((u) => u.type === "number")
        .map(build)
        .join("");

      modal.innerHTML = `
        <style>a:hover { text-decoration: underline !important; }</style>
        <button id="closeSettingsX" style="${STYLES.btnObj.closeX}">×</button>
        <h3 style="${STYLES.sectionHeader}">NexusNoWait++ Settings</h3>
        <div style="${STYLES.section}"><h4 style="${STYLES.sectionHeader}">Features</h4>${features}</div>
        <div style="${STYLES.section}"><h4 style="${STYLES.sectionHeader}">Timing</h4>${timing}</div>
        <div style="display:flex;justify-content:center;gap:10px;margin-top:20px;"><button id="resetSettings" style="${STYLES.btnObj.secondary}">Reset</button><button id="closeSettings" style="${STYLES.btnObj.primary}">Save & Close</button></div>
        <div style="text-align:center;margin-top:12px;color:#666;font-size:12px;">v${GM_info.script.version} by Torkelicious</div>
        <div style="text-align:center;margin-top:6px;color:#666;font-size:10px;"><a href="https://github.com/torkelicious/nexus-no-wait-pp/" target="_blank" style="color:#666;">This software is open-source and licensed under the GPLv3</a></div>
      `;

      const update = (element) => {
        const key = element.getAttribute("data-setting");
        if (!key) return;
        let value =
          element.type === "checkbox"
            ? element.checked
            : element.type === "number"
              ? parseInt(element.value, 10)
              : element.value;
        if (typeof value === "number" && isNaN(value)) {
          element.value = cfg[key];
          return;
        }
        if (cfg[key] !== value) {
          cfg[key] = value;
          save();
        }
        if (key === "AutoStartDownload") {
          const row = modal
            .querySelector('[data-setting="AutoCloseTab"]')
            ?.closest("div");
          if (row) row.style.display = element.checked ? "block" : "none";
        }
        if (key === "AutoCloseTab") {
          const row = modal
            .querySelector('[data-setting="CloseTabDelay"]')
            ?.closest("div");
          if (row) row.style.display = element.checked ? "block" : "none";
        }
        if (key === "PlayErrorSound") {
          const row = modal
            .querySelector('[data-setting="ErrorSoundUrl"]')
            ?.closest("div");
          if (row) row.style.display = element.checked ? "block" : "none";
        }
      };

      modal.addEventListener("change", (event) => {
        if (event.target?.hasAttribute("data-setting")) update(event.target);
      });
      modal.addEventListener("input", (event) => {
        if (
          (event.target.type === "number" || event.target.type === "text") &&
          event.target?.hasAttribute("data-setting")
        )
          update(event.target);
      });

      const closeX = modal.querySelector("#closeSettingsX");
      const closeBtn = modal.querySelector("#closeSettings");
      const resetBtn = modal.querySelector("#resetSettings");

      function closeModal() {
        if (activeModal) {
          activeModal.remove();
          activeModal = null;
        }
        if (activeBackdrop) {
          activeBackdrop.remove();
          activeBackdrop = null;
        }
        document.removeEventListener("keydown", onSettingsKeyDown);
      }
      const onSettingsKeyDown = (event) => {
        if (event.key === "Escape") closeModal();
      };

      closeX.addEventListener("click", closeModal);
      closeBtn.addEventListener("click", closeModal);
      resetBtn.addEventListener("click", () => {
        Object.assign(cfg, DEFAULTS);
        save();
        closeModal();
      });

      document.body.appendChild(modal);
      activeModal = modal;
      document.addEventListener("keydown", onSettingsKeyDown);
    }

    if (!document.getElementById("nnwpp-btn")) {
      const btn = document.createElement("div");
      btn.id = "nnwpp-btn";
      btn.textContent = "NexusNoWait++ ⚙️";
      btn.style.cssText = STYLES.btn;
      btn.onclick = showSettingsModal;
      btn.onmouseover = () => (btn.style.transform = "translateY(-2px)");
      document.body.appendChild(btn);
    }
  }

  main();
})();
