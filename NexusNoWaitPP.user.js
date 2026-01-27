// ==UserScript==
// @name        Nexus No Wait ++
// @description Skip Countdown, Auto Download, and More for Nexus Mods. Supports (Manual/Vortex/MO2/NMM)
// @version     2.0.3
// @namespace   NexusNoWaitPlusPlus
// @author      Torkelicious
// @iconURL     https://raw.githubusercontent.com/torkelicious/nexus-no-wait-pp/refs/heads/main/icon.png
// @icon        https://raw.githubusercontent.com/torkelicious/nexus-no-wait-pp/refs/heads/main/icon.png
// @license     GPL-3.0-or-later
// @include     https://*.nexusmods.com/*
// @run-at      document-idle
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM.xmlHttpRequest
// @grant       GM_info
// @grant       GM_addStyle
// @grant       GM_listValues
// @grant       GM_deleteValue
// @connect     *.nexusmods.com
// @connect     raw.githubusercontent.com
// ==/UserScript==

;(function () {
  'use strict'

  // Config
  const CONFIG_KEY = 'NexusNoWaitPP'
  const DEFAULTS = {
    AutoStartDownload: true,
    AutoCloseTab: true,
    SkipRequirements: true,
    ShowAlertsOnError: true,
    PlayErrorSound: true,
    ErrorSoundUrl: 'https://github.com/torkelicious/nexus-no-wait-pp/raw/refs/heads/main/errorsound.mp3',
    HandleArchivedFiles: true,
    HidePremiumUpsells: false,
    CloseTabDelay: 2000,
    RequestTimeout: 30000
  }
  function loadConfig() {
    try {
      const raw = typeof GM_getValue === 'function' ? GM_getValue(CONFIG_KEY, null) : null
      return raw
        ? {
            ...DEFAULTS,
            ...(typeof raw === 'string' ? JSON.parse(raw) : raw)
          }
        : DEFAULTS
    } catch (e) {
      return DEFAULTS
    }
  }

  // this exists because previous versions have a different config system
  async function cleanResetConfig() {
    // remove all GM storage keys stored
    if (typeof GM_listValues === 'function' && typeof GM_deleteValue === 'function') {
      const keys = await GM_listValues()
      for (const key of keys) {
        await GM_deleteValue(key)
      }
    }
    // Reset cfg to default
    Object.assign(cfg, DEFAULTS)
    // save defaults back to storage
    if (typeof GM_setValue === 'function') {
      await GM_setValue(CONFIG_KEY, JSON.stringify(cfg))
    }
    location.reload()
  }

  let cfg = loadConfig()

  const Logger = (() => {
    const prefix = () => `[NexusNoWait++ v${GM_info.script.version}]`
    const format = (...args) => [prefix(), ...args, `\n at:(${location.href})`]
    const log =
      level =>
      (...args) =>
        console[level](...format(...args))
    return {
      debug: log('debug'),
      info: log('info'),
      warn: log('warn'),
      error: log('error')
    }
  })()

  let errorAudioPlayer = null
  function setupAudio() {
    // audio preloading
    if (!cfg.PlayErrorSound || !cfg.ErrorSoundUrl) return
    errorAudioPlayer = new Audio(cfg.ErrorSoundUrl)
    errorAudioPlayer.preload = 'auto'
    errorAudioPlayer.load()
  }

  function playErrorSound() {
    if (errorAudioPlayer) {
      errorAudioPlayer.currentTime = 0
      errorAudioPlayer.play().catch(e => Logger.warn('Error playing sound:', e))
    }
  }

  function parseDownloadURLFromResponse(text) {
    if (!text) return null
    const inputText = String(text)
    try {
      const json = JSON.parse(inputText)
      if (json && json.url) {
        return {
          url: json.url.replace(/&amp;/g, '&'),
          source: 'json-url'
        }
      }
    } catch (_) {}
    const match = inputText.match(/id=["']dl_link["'][^>]*value=["']([^"']+)["']/i)
    if (match) {
      return {
        url: match[1].replace(/&amp;/g, '&'),
        source: 'dl_link-value'
      }
    }
    return null
  }

  async function getDownloadUrl({ fileId, gameId, isNMM, href }) {
    if (!fileId) return { url: null, error: 'Missing fileId' }

    const fetchText = url =>
      new Promise(resolve => {
        GM.xmlHttpRequest({
          method: 'GET',
          url,
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          onload(response) {
            resolve(response.response || response.responseText || '')
          },
          onerror(error) {
            Logger.warn('Fetch error for', url, error)
            resolve('')
          },
          ontimeout() {
            Logger.warn('Fetch timeout for', url)
            resolve('')
          }
        })
      })

    const parseDownloadLink = text => {
      if (!text) return null
      const nxmMatch = text.match(/(nxm:\/\/[\w\W]+?)(["'\s<>]|$)/i)
      if (nxmMatch) return nxmMatch[1]
      const keyMatch = text.match(/['"]([^'"']*?key[^'"']*?)['"]/)
      if (keyMatch) return keyMatch[1]
      return null
    }

    if (isNMM && href) {
      const firstResponse = await fetchText(href)
      Logger.info('First NMM fetch URL:', href)
      Logger.info('First NMM response:', firstResponse)

      const link = parseDownloadLink(firstResponse)
      if (link) return { url: link }

      if (/ModRequirementsPopUp/.test(href)) {
        const downloadHrefMatch = firstResponse.match(/href=["']([^"']*?file_id[^"']*?)["']/i)
        if (downloadHrefMatch) {
          const downloadUrl = downloadHrefMatch[1]
          Logger.info('Parsed download URL from popup:', downloadUrl)
          const downloadPageResponse = await fetchText(downloadUrl)
          Logger.info('Download page response:', downloadPageResponse)
          const link2 = parseDownloadLink(downloadPageResponse)
          if (link2) return { url: link2 }
        }
      }
      return { url: null, error: 'No NMM download link found' }
    }

    // Manual logic
    const endpoint = '/Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl'
    const body = `fid=${encodeURIComponent(fileId)}&game_id=${encodeURIComponent(gameId || '')}`
    return await new Promise(resolve => {
      GM.xmlHttpRequest({
        method: 'POST',
        url: endpoint,
        data: body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Origin: 'https://www.nexusmods.com',
          Referer: location.href
        },
        timeout: cfg.RequestTimeout,
        onload(response) {
          const responseText = response.response || response.responseText || ''
          const extracted = parseDownloadURLFromResponse(responseText)
          if (extracted) resolve({ url: extracted.url })
          else
            resolve({
              url: null,
              error: 'No URL in response\n(Are you logged in?)'
            })
        },
        onerror() {
          resolve({ url: null, error: 'Request failed' })
        },
        ontimeout() {
          resolve({ url: null, error: 'Timeout' })
        }
      })
    })
  }

  function setButtonState(button, state, message) {
    try {
      const textElement = button.querySelector('span.flex-label, span') || button
      const stateConfig = {
        waiting: { text: 'Please Wait...', color: 'orange' },
        downloading: { text: 'Downloading!', color: 'green' },
        error: { text: message || 'Error', color: 'red' }
      }
      const config = stateConfig[state] || stateConfig.error
      textElement.innerText = config.text
      button.style.color = config.color
    } catch (e) {}
  }

  function attachClickInterceptor() {
    async function handleDownload(btn, fileId, isNMM, href) {
      setButtonState(btn, 'waiting')
      Logger.debug('fileId', fileId, 'isNMM', isNMM)
      const { url, error } = await getDownloadUrl({
        fileId,
        gameId: document.getElementById('section')?.dataset?.gameId || '',
        isNMM,
        href
      })
      if (error) {
        setButtonState(btn, 'error', error)
        if (cfg.PlayErrorSound) playErrorSound()
        if (cfg.ShowAlertsOnError) alert(`Download error: ${error}`)
        return
      }
      setButtonState(btn, 'downloading')
      location.assign(url)
    }

    const extractFileId = href => {
      try {
        const url = new URL(href, location.href)
        return url.searchParams.get('file_id') || url.searchParams.get('id')
      } catch {}
      return null
    }

    document.body.addEventListener(
      'click',
      async function (event) {
        const element = event.target.closest('a,button')
        if (!element) return

        const linkHref = element.href || element.getAttribute('href') || ''
        if (!linkHref) return
        const fileId = extractFileId(linkHref)
        if (!fileId) return

        const hasRequirements = linkHref.includes('ModRequirementsPopUp') || linkHref.includes('tab=requirements')
        const isNMM = linkHref.includes('nmm=1') || linkHref.includes('&nmm') || element.closest('#action-nmm') !== null

        if (hasRequirements && cfg.SkipRequirements) {
          event.preventDefault()
          event.stopImmediatePropagation()
          handleDownload(element, fileId, isNMM, linkHref)
          return
        }
        if (hasRequirements && !cfg.SkipRequirements) {
          return
        }
        event.preventDefault()
        event.stopImmediatePropagation()
        handleDownload(element, fileId, isNMM, linkHref)
      },
      true
    )

    if (location.search.includes('file_id')) {
      const setupSlowDownloadIntercept = () => {
        const modFileDownload = document.querySelector('mod-file-download')
        if (modFileDownload?.shadowRoot) {
          const slowDownloadBtn = modFileDownload.shadowRoot.querySelector(
            '#upsell-cards > div.flex.flex-col.justify-between.gap-y-6.rounded-lg.bg-surface-translucent-low.p-6 > button'
          )
          if (slowDownloadBtn) {
            slowDownloadBtn.addEventListener('click', async event => {
              event.preventDefault()
              event.stopImmediatePropagation()
              const params = new URLSearchParams(location.search)
              const fileId = params.get('file_id')
              if (!fileId) return
              const isNMM = params.has('nmm') || params.get('nmm') === '1'
              Logger.debug('Slow download intercept: fileId', fileId, 'isNMM', isNMM)
              setButtonState(slowDownloadBtn, 'waiting')
              const { url } = await getDownloadUrl({
                fileId,
                gameId: document.getElementById('section')?.dataset?.gameId || '',
                isNMM,
                href: location.href
              })
              if (url) {
                setButtonState(slowDownloadBtn, 'downloading')
                Logger.info(`Slow download ${isNMM ? 'NMM' : 'manual'}: starting download`)
                location.assign(url)
              }
            })
          }
        }
      }

      setupSlowDownloadIntercept()
      const observer = new MutationObserver(() => {
        setupSlowDownloadIntercept()
      })
      observer.observe(document.body, { childList: true, subtree: true })
    }
  }

  function interceptRequirementsTab() {
    document.body.addEventListener(
      'click',
      function (event) {
        const linkElement = event.target.closest("a[href*='tab=requirements']")
        if (!linkElement) return
        if (!cfg.SkipRequirements) return
        event.preventDefault()
        event.stopImmediatePropagation()
        const linkHref = linkElement.href || linkElement.getAttribute('href') || ''
        location.replace(linkHref.replace('tab=requirements', 'tab=files'))
      },
      true
    )
  }

  async function autoStartDownload() {
    if (!cfg.AutoStartDownload) return
    const params = new URLSearchParams(location.search)
    const fileId = params.get('file_id')
    if (!fileId) return
    const isNMM = params.has('nmm') || params.get('nmm') === '1'
    Logger.debug('Auto-start: fileId', fileId, 'isNMM', isNMM)
    await new Promise(r => setTimeout(r, 200))
    const { url } = await getDownloadUrl({
      fileId,
      gameId: document.getElementById('section')?.dataset?.gameId || '',
      isNMM,
      href: location.href
    })
    if (url) {
      Logger.info(
        `Auto ${isNMM ? 'NMM' : 'manual'}: final URL type`,
        url.startsWith('nxm://') ? 'nxm' : url.startsWith('https://') ? 'https' : 'other'
      )
      location.assign(url)
      if (cfg.AutoCloseTab) setTimeout(() => window.close(), cfg.CloseTabDelay)
    }
  }

  function upsellBlocker() {
    if (!cfg.HidePremiumUpsells) return
    const elementsToHideSelectors = [
      // IDs
      '#nonPremiumBanner',
      '#freeTrialBanner',
      '#ig-banner-container',
      '#rj-vortex',
      // broad class matches for dynamic content
      '[class*="ads-bottom"]',
      '[class*="ads-top"]',
      '[class*="to-premium"]',
      '[class*="from-premium"]',
      '[class*="premium"]',
      // specific page elements
      '#mainContent > div.ads-holder.clearfix.ads-top',
      '#mainContent > div.ads-holder.clearfix.ads-bottom',
      '#mainContent > div > div.relative.next-container > div > section.flex.items-center.justify-center > div',
      '#mainContent > div > div.relative.next-container > div > a',
      '#headlessui-menu-items-_r_ap_ > div.flex.flex-col.gap-y-4.px-3.py-2 > div.hidden.md\\:block',
      '#head > div.rj-right-tray.rj-profile-tray.rj-open > ul > li.user-profile-menu-section-top > a',
      '#mainContent > div.flex.items-center.justify-center.gap-x-4.border-y.border-stroke-subdued.bg-surface-low.py-2',
      '#mainContent > div.hidden.items-center.justify-center.gap-x-4.border-b.border-stroke-subdued.bg-surface-low.py-2.md\\:flex',
      '#mainContent > div.relative > div.relative.next-container.pb-20 > div.space-y-16 > div.relative.overflow-hidden.rounded-lg.border-2.border-\[\#FCD23F\]',
      '#mainContent > div.relative > div.relative.next-container.pb-20 > div.mb-6.w-full.space-y-6.border-b.border-stroke-weak.pt-4.pb-6.sm\\:mb-0.sm\\:border-none.sm\\:pb-8 > section > div.flex.flex-col.gap-2.rounded-sm.bg-surface-translucent-low.p-2.5.backdrop-blur-xs.xs\\:w-fit.xs\\:max-w-sm.order-4.h-fit.w-full',
      '#filters-panel > div.mt-4.hidden.rounded-lg.border.border-creator-subdued.bg-creator-weak.bg-cover.p-4'
    ]
    // hide all selectors
    GM_addStyle(elementsToHideSelectors.map(selector => `${selector}{display:none!important}`).join('\n'))

    // hide upsells in shadow root
    const modFileDownloadElement = document.querySelector('mod-file-download')
    if (modFileDownloadElement?.shadowRoot) {
      const shadowStyle = document.createElement('style')
      shadowStyle.textContent =
        '#upsell-cards > div.relative.flex.flex-col.justify-between.gap-y-6.rounded-lg.border.bg-gradient-to-t.from-premium-weak.from-25\\%.to-premium-900.to-75\\%.p-6.sm\\:order-last.border-premium-100.border-premium-moderate{display:none!important}'
      modFileDownloadElement.shadowRoot.appendChild(shadowStyle)
    }
    // hide premium upsell banner
    const premiumBanner = document.querySelector('.bg-nexus-premium-gradient')
    if (premiumBanner) {
      premiumBanner.remove()
      Logger.info('Removed premium upsell banner')
    }
  }

  function waitForElement(selector, cb) {
    const el = document.querySelector(selector)
    if (el) cb(el)
    const mo = new MutationObserver(() => {
      const el = document.querySelector(selector)
      if (el) {
        cb(el)
      }
    })
    mo.observe(document.body, { childList: true, subtree: true })
  }

  function archivedFileHandler() {
    if (!cfg.HandleArchivedFiles) return
    const url = location.href
    if (url.includes('tab=files') && !url.includes('category=archived')) {
      waitForElement('#files-tab-footer', footer => {
        footer.querySelector('p')?.style.setProperty('display', 'none')
        // Check for any existing 'File archive' button
        const hasArchiveBtn = Array.from(footer.querySelectorAll('a.btn.inline-flex .flex-label')).some(
          el => el.textContent.trim() === 'File archive'
        )
        if (!hasArchiveBtn) {
          footer.insertAdjacentHTML(
            'beforeend',
            `<a class="btn inline-flex" data-archived-btn="true" href="${url}&category=archived" style="background:#da8e35;color:#fff;margin-left:8px;"><span class="flex-label">File archive</span></a>`
          )
        }
      })
    }
    if (!url.includes('category=archived')) return
    const headers = Array.from(document.getElementsByClassName('file-expander-header'))
    const downloads = Array.from(document.getElementsByClassName('accordion-downloads'))
    const base = location.origin + location.pathname
    for (const [i, header] of headers.entries()) {
      const fileId = header?.dataset?.id
      const box = downloads[i]
      if (!fileId || !box || box.dataset.done) continue
      box.dataset.done = '1'
      box.innerHTML = `
      <a class="btn inline-flex" href="${base}?tab=files&file_id=${fileId}&nmm=1"><span class="flex-label">Mod manager download</span></a>
      <a class="btn inline-flex" href="${base}?tab=files&file_id=${fileId}"><span class="flex-label">Manual download</span></a>
    `
    }
  }

  function main() {
    setupAudio()
    attachClickInterceptor()
    interceptRequirementsTab()
    autoStartDownload()
    upsellBlocker()
    archivedFileHandler()
    SettingsUI()
    Logger.debug('NNW++ initiated')
  }

  function SettingsUI() {
    const SETTING_UI = [
      {
        key: 'AutoStartDownload',
        label: 'Auto Start Download on file_id= URLs',
        type: 'bool',
        description: 'Automatically start downloads when visiting file download pages (URLs containing file_id=)'
      },
      {
        key: 'AutoCloseTab',
        label: 'Auto-Close Tab After Automatic Download ',
        type: 'bool',
        description: 'Automatically close the tab after a download starts on file download pages',
        showIf: () => cfg.AutoStartDownload
      },
      {
        key: 'SkipRequirements',
        label: 'Skip Requirements PopUp/Tab',
        type: 'bool',
        description: 'Skip the requirements popup/page and proceed directly to download'
      },
      {
        key: 'ShowAlertsOnError',
        label: 'Show Alert Messages on Errors',
        type: 'bool',
        description: 'Display error messages as browser popup alerts'
      },
      {
        key: 'PlayErrorSound',
        label: 'Play Error Sound',
        type: 'bool',
        description: 'Play an error sound when download errors occur'
      },

      {
        key: 'HidePremiumUpsells',
        label: 'Hide Premium Upsells & misc Annoyances (experimental)',
        type: 'bool',
        description:
          'Hide premium upgrade banners, trial offers, and other Annoyances on the site (experimental)\n slow and buggy, you are probably better off using an adblocker.'
      },
      {
        key: 'RequestTimeout',
        label: 'Request Timeout',
        type: 'number',
        description: 'Maximum time to wait for server responses before timing out (in milliseconds)'
      },
      {
        key: 'CloseTabDelay',
        label: 'Auto-Close Tab Delay',
        type: 'number',
        description: 'Delay before automatically closing the tab after download starts (in milliseconds)',
        showIf: () => cfg.AutoCloseTab
      },
      {
        key: 'ErrorSoundUrl',
        label: 'Error Sound URL',
        type: 'text',
        description: 'URL of the custom sound file to play for error alerts',
        showIf: () => cfg.PlayErrorSound
      },
      {
        key: 'HandleArchivedFiles',
        label: 'Generate download buttons for Archived Files',
        type: 'bool',
        description: 'Enable handling of archived files.'
      }
    ]
    const STYLES = {
      btn: "position:fixed;bottom:20px;right:20px;background:#2f2f2f;color:#fff;padding:10px 15px;border-radius:4px;cursor:pointer;z-index:9999;font-family:'Inter','Helvetica Neue', Helvetica, Arial, sans-serif;font-size:14px;border:none;",
      modal:
        "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#2f2f2f;color:#dadada;padding:25px;border-radius:4px;z-index:10000;min-width:300px;max-width:90%;max-height:90vh;overflow-y:auto;font-family:'Inter','Helvetica Neue', Helvetica, Arial, sans-serif;",
      backdrop: 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:9999;',
      section: 'background:#363636;padding:15px;border-radius:4px;margin-bottom:15px;',
      sectionHeader: 'color:#da8e35;margin:0 0 10px 0;font-size:16px;font-weight:500;',
      input: 'background:#2f2f2f;border:1px solid #444;color:#dadada;border-radius:3px;padding:5px;',
      row: 'margin-bottom:10px;',
      label: 'display:flex;align-items:center;gap:8px;',
      btnObj: {
        primary: 'padding:8px 15px;border:none;background:#da8e35;color:white;border-radius:3px;cursor:pointer;',
        secondary:
          'padding:8px 15px;border:1px solid #da8e35;background:transparent;color:#da8e35;border-radius:3px;cursor:pointer;',
        advanced: 'padding:4px 8px;background:transparent;color:#666;border:none;cursor:pointer;',
        closeX:
          'position:absolute;top:10px;right:10px;background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;padding:5px;'
      }
    }
    function save() {
      try {
        GM_setValue(CONFIG_KEY, JSON.stringify(cfg))
      } catch (e) {}
    }
    let activeModal = null
    let activeBackdrop = null
    function showSettingsModal() {
      cfg = loadConfig()
      if (activeModal) activeModal.remove()
      if (activeBackdrop) activeBackdrop.remove()

      const backdrop = document.createElement('div')
      backdrop.style.cssText = STYLES.backdrop
      backdrop.addEventListener('click', closeModal)
      document.body.appendChild(backdrop)
      activeBackdrop = backdrop

      const modal = document.createElement('div')
      modal.style.cssText = STYLES.modal

      const build = setting => {
        const shouldShow = !setting.showIf || setting.showIf()
        if (setting.type === 'bool')
          return `<div style="${STYLES.row};display:${shouldShow ? 'block' : 'none'}"><label title="${setting.description}" style="${STYLES.label}"><input type="checkbox" data-setting="${setting.key}" ${cfg[setting.key] ? 'checked' : ''}><span>${setting.label}</span></label></div>`
        if (setting.type === 'number') {
          const step = setting.key === 'CloseTabDelay' ? 100 : 1
          return `<div style="${STYLES.row};display:${shouldShow ? 'block' : 'none'}"><label title="${setting.description}" style="${STYLES.label}"><span>${setting.label}:</span><input type="number" value="${cfg[setting.key]}" min="0" step="${step}" data-setting="${setting.key}" style="${STYLES.input};width:120px;"></label></div>`
        }
        if (setting.type === 'text')
          return `<div style="${STYLES.row};display:${shouldShow ? 'block' : 'none'}"><label title="${setting.description}" style="${STYLES.label}"><span style="font-size:0.9em;color:#aaa;">${setting.label}:</span><input type="text" value="${cfg[setting.key]}" data-setting="${setting.key}" style="${STYLES.input};width:95%;"></label></div>`
        return ''
      }

      const features = SETTING_UI.filter(u => (u.type === 'bool' || u.type === 'text') && u.key !== 'RefreshOnError')
        .map(build)
        .join('')
      const timing = SETTING_UI.filter(u => u.type === 'number')
        .map(build)
        .join('')

      modal.innerHTML = `
        <style>a:hover { text-decoration: underline !important; }</style>
        <button id="closeSettingsX" style="${STYLES.btnObj.closeX}">×</button>
        <h3 style="${STYLES.sectionHeader}">NexusNoWait++ Settings</h3>
        <div style="${STYLES.section}"><h4 style="${STYLES.sectionHeader}">Features</h4>${features}</div>
        <div style="${STYLES.section}"><h4 style="${STYLES.sectionHeader}">Timing</h4>${timing}</div>
        <div style="display:flex;justify-content:center;gap:10px;margin-top:20px;"><button id="resetSettings" style="${STYLES.btnObj.secondary}">Reset Settings</button><button id="closeSettings" style="${STYLES.btnObj.primary}">Save & Close</button></div>
        <div style="text-align:center;margin-top:12px;color:#666;font-size:12px;">v${GM_info.script.version} by Torkelicious</div>
        <div style="text-align:center;margin-top:6px;color:#666;font-size:10px;"><a href="https://github.com/torkelicious/nexus-no-wait-pp/" target="_blank" style="color:#666;">This software is open-source and licensed under the GPLv3</a></div>
      `

      const update = element => {
        const key = element.getAttribute('data-setting')
        if (!key) return
        let value =
          element.type === 'checkbox'
            ? element.checked
            : element.type === 'number'
              ? parseInt(element.value, 10)
              : element.value
        if (typeof value === 'number' && isNaN(value)) {
          element.value = cfg[key]
          return
        }
        if (cfg[key] !== value) {
          cfg[key] = value
          save()
        }
        if (key === 'AutoStartDownload') {
          const row = modal.querySelector('[data-setting="AutoCloseTab"]')?.closest('div')
          if (row) row.style.display = element.checked ? 'block' : 'none'
        }
        if (key === 'AutoCloseTab') {
          const row = modal.querySelector('[data-setting="CloseTabDelay"]')?.closest('div')
          if (row) row.style.display = element.checked ? 'block' : 'none'
        }
        if (key === 'PlayErrorSound') {
          const row = modal.querySelector('[data-setting="ErrorSoundUrl"]')?.closest('div')
          if (row) row.style.display = element.checked ? 'block' : 'none'
        }
      }

      modal.addEventListener('change', event => {
        if (event.target?.hasAttribute('data-setting')) update(event.target)
      })
      modal.addEventListener('input', event => {
        if (
          (event.target.type === 'number' || event.target.type === 'text') &&
          event.target?.hasAttribute('data-setting')
        )
          update(event.target)
      })

      const closeX = modal.querySelector('#closeSettingsX')
      const closeBtn = modal.querySelector('#closeSettings')
      const resetBtn = modal.querySelector('#resetSettings')

      function closeModal() {
        if (activeModal) {
          activeModal.remove()
          activeModal = null
        }
        if (activeBackdrop) {
          activeBackdrop.remove()
          activeBackdrop = null
        }
        document.removeEventListener('keydown', onSettingsKeyDown)
      }
      const onSettingsKeyDown = event => {
        if (event.key === 'Escape') closeModal()
      }

      closeX.addEventListener('click', closeModal)
      closeBtn.addEventListener('click', closeModal)
      resetBtn.addEventListener('click', async () => {
        await cleanResetConfig()
        closeModal()
      })

      document.body.appendChild(modal)
      activeModal = modal
      document.addEventListener('keydown', onSettingsKeyDown)
    }

    if (!document.getElementById('nnwpp-btn')) {
      const btn = document.createElement('div')
      btn.id = 'nnwpp-btn'
      btn.textContent = 'NexusNoWait++ ⚙️'
      btn.style.cssText = STYLES.btn
      btn.onclick = showSettingsModal
      btn.onmouseover = () => (btn.style.transform = 'translateY(-2px)')
      document.body.appendChild(btn)
      // keep button persistent if removed by react hydration -.-
      const observer = new MutationObserver(() => {
        if (!document.getElementById('nnwpp-btn')) {
          document.body.appendChild(btn)
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
    }
  }

  main() // first run
  // spa navigation support to re-run main() on URL change
  let lastUrl = location.href
  const originalPushState = history.pushState
  const originalReplaceState = history.replaceState
  history.pushState = function (...args) {
    originalPushState.apply(this, args)
    if (location.href !== lastUrl) {
      lastUrl = location.href
      main()
    }
  }
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args)
    if (location.href !== lastUrl) {
      lastUrl = location.href
      main()
    }
  }
  window.addEventListener('popstate', () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      main()
    }
  })
  // fallback for other changes
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      main()
    }
  }).observe(document.body, { subtree: true, childList: true })
})()
