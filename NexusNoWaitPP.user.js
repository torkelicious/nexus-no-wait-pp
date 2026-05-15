// ==UserScript==
// @name        Nexus No Wait ++
// @description Skip Countdown, Auto Download, and More for Nexus Mods. Supports (Manual/Vortex/MO2/NMM)
// @version     2.1.5
// @namespace   NexusNoWaitPlusPlus
// @author      Torkelicious
// @iconURL     https://raw.githubusercontent.com/torkelicious/nexus-no-wait-pp/refs/heads/main/icon.png
// @icon        https://raw.githubusercontent.com/torkelicious/nexus-no-wait-pp/refs/heads/main/icon.png
// @license     GPL-3.0-or-later
// @match       https://*.nexusmods.com/*
// @run-at      document-idle
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM.xmlHttpRequest
// @grant       GM_xmlhttpRequest
// @grant       GM_info
// @grant       GM_addStyle
// @connect     *.nexusmods.com
// @connect     raw.githubusercontent.com
// ==/UserScript==

;(function () {
  'use strict'

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
    ForceModManagerDownload: false,
    CloseTabDelay: 2000,
    RequestTimeout: 30000
  }

  const Logger = (() => {
    const tag = () => `[NexusNoWait++ v${GM_info.script.version}]`
    return ['debug', 'info', 'warn', 'error'].reduce((o, lvl) => {
      o[lvl] = (...a) => console[lvl](tag(), ...a)
      return o
    }, {})
  })()

  const logEvent = (level, event, data = {}) => Logger[level](event, data)

  function loadConfig() {
    try {
      const raw = typeof GM_getValue === 'function' ? GM_getValue(CONFIG_KEY, null) : null
      const parsed = raw ? { ...DEFAULTS, ...(typeof raw === 'string' ? JSON.parse(raw) : raw) } : DEFAULTS
      logEvent('debug', 'config:load', { activeConfig: parsed })
      return parsed
    } catch (e) {
      Logger.warn('Failed to load config, using defaults', e)
      return DEFAULTS
    }
  }

  function cleanResetConfig() {
    logEvent('info', 'config:reset-requested')
    Object.assign(cfg, DEFAULTS)
    if (typeof GM_setValue === 'function') GM_setValue(CONFIG_KEY, JSON.stringify(cfg))
    location.reload()
  }

  let cfg = loadConfig()
  let listenersAttached = false
  let slowDownloadObserver = null
  let forceNmmObserver = null

  const gmXmlHttpRequest = typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest.bind(GM) : typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null

  if (!gmXmlHttpRequest) Logger.error('No GM XHR API available. Script may not function correctly.')

  function gmRequest(url, opts = {}) {
    return new Promise(resolve => {
      gmXmlHttpRequest({
        method: 'GET',
        ...opts,
        url,
        timeout: opts.timeout ?? cfg.RequestTimeout,
        headers: opts.headers || {},
        onload: r =>
          resolve({
            text: r.responseText || '',
            finalUrl: r.finalUrl || '',
            headers: r.responseHeaders || ''
          }),
        onerror: e => {
          logEvent('error', 'network:request-failed', { url, error: e })
          resolve({ text: '', finalUrl: '', headers: '' })
        },
        ontimeout: () => {
          logEvent('warn', 'network:request-timeout', { url })
          resolve({ text: '', finalUrl: '', headers: '' })
        }
      })
    })
  }

  const getGameId = () => document.getElementById('section')?.dataset?.gameId || ''

  let errorAudioPlayer = null
  function setupAudio() {
    if (!cfg.PlayErrorSound || !cfg.ErrorSoundUrl || errorAudioPlayer) return
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

  const MOD_PAGE_PATTERN = /\/mods\/\d+$/
  function isModPage() {
    return MOD_PAGE_PATTERN.test(location.pathname)
  }

  function parseDownloadURLFromResponse(text) {
    if (!text) return null
    try {
      const json = JSON.parse(String(text))
      if (json?.url) return { url: json.url.replace(/&amp;/g, '&') }
    } catch {
      /* empty */
    }
    const match = String(text).match(/id=["']dl_link["'][^>]*value=["']([^"']+)["']/i)
    return match ? { url: match[1].replace(/&amp;/g, '&') } : null
  }

  function parseDownloadLink(text) {
    if (!text) return null
    text = String(text).replace(/&amp;/g, '&').replace(/\\\//g, '/')
    const match = text.match(/nxm:\/\/[^\s"'<>]+/i)
    if (!match) return null
    const url = match[0]
    const queryIndex = url.indexOf('?')
    if (queryIndex === -1) return null
    const params = new URLSearchParams(url.slice(queryIndex + 1))
    if (!params.has('key') || !params.has('expires') || !params.has('user_id')) return null
    return url
  }

  async function getDownloadUrl({ fileId, gameId, isNMM, href }) {
    if (!fileId && !href) return { url: null, error: 'Missing fileId' }
    if (href && href.includes('/api/files/')) {
      logEvent('info', 'download:resolve-api', { href })
      let targetApiUrl = href
      if (isNMM && !targetApiUrl.includes('nmm=1')) {
        targetApiUrl += (targetApiUrl.includes('?') ? '&' : '?') + 'nmm=1'
      }

      try {
        const res = await gmRequest(targetApiUrl, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })

        let link = res.finalUrl && res.finalUrl !== targetApiUrl ? res.finalUrl : null
        const locationMatch = res.headers.match(/Location:\s*(nxm:\/\/[^\s]+)/i)
        if (locationMatch) link = locationMatch[1]
        const extractedJson = parseDownloadURLFromResponse(res.text)
        if (extractedJson) link = extractedJson.url
        const extractedNxm = parseDownloadLink(res.text) || parseDownloadLink(res.finalUrl)
        if (extractedNxm) link = extractedNxm

        if (link) return { url: link }
        return { url: null, error: 'Failed to resolve API link' }
      } catch (err) {
        Logger.warn('API fetch failed:', err)
      }
    }

    if (isNMM && href) {
      const res = await gmRequest(href, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      })
      let link = parseDownloadLink(res.finalUrl)
      if (link) return { url: link }

      const locationMatch = res.headers.match(/Location:\s*(nxm:\/\/[^\s]+)/i)
      if (locationMatch) return { url: locationMatch[1] }
      link = parseDownloadLink(res.text)
      if (link) return { url: link }

      if (/ModRequirementsPopUp/.test(href)) {
        const downloadHrefMatch = res.text.match(/href=["']([^"']*?file_id[^"']*?)["']/i)
        if (downloadHrefMatch) {
          const res2 = await gmRequest(downloadHrefMatch[1])
          link = parseDownloadLink(res2.finalUrl)
          if (link) return { url: link }
          const locationMatch2 = res2.headers.match(/Location:\s*(nxm:\/\/[^\s]+)/i)
          if (locationMatch2) return { url: locationMatch2[1] }
          link = parseDownloadLink(res2.text)
          if (link) return { url: link }
        }
      }

      return { url: null, error: 'No NMM download link found (flow changed?)' }
    }

    if (fileId) {
      const endpoint = '/Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl'
      const body = `fid=${encodeURIComponent(fileId)}&game_id=${encodeURIComponent(gameId || '')}`
      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      }

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          credentials: 'same-origin',
          headers,
          body,
          signal: AbortSignal.timeout(cfg.RequestTimeout)
        })
        const extracted = parseDownloadURLFromResponse(await response.text())
        if (extracted) return { url: extracted.url }
      } catch {
        const res = await gmRequest(endpoint, {
          method: 'POST',
          data: body,
          headers: {
            ...headers,
            Origin: 'https://www.nexusmods.com',
            Referer: location.href
          }
        })
        const extracted = parseDownloadURLFromResponse(res.text)
        if (extracted) return { url: extracted.url }
      }
    }

    return { url: null, error: 'Could not resolve file link' }
  }

  async function normalizeDownloadUrl(url, isNMM) {
    if (!url) return url
    if (url.includes('nexusmods.com') && url.includes('file_id=')) {
      try {
        const parsed = new URL(url, location.href)
        const fileId = parsed.searchParams.get('file_id')
        if (fileId) {
          const res = await getDownloadUrl({
            fileId,
            gameId: getGameId(),
            isNMM,
            href: url
          })
          if (res?.url) return res.url
        }
      } catch {
        /* empty */
      }
    }
    return url
  }

  async function startDownloadFlow({ btn, fileId, isNMM, href, isAutoStart = false }) {
    if (btn) setButtonState(btn, 'waiting')
    logEvent('debug', isAutoStart ? 'download:auto-start' : 'download:start', { fileId, isNMM, href })

    const { url, error } = await getDownloadUrl({
      fileId,
      gameId: getGameId(),
      isNMM,
      href
    })
    if (error) return handleError(btn || null, error)

    if (btn) setButtonState(btn, 'downloading')

    const finalUrl = await normalizeDownloadUrl(url, isNMM)
    if (!finalUrl) return handleError(btn || null, 'Failed to resolve download URL')

    logEvent('info', 'download:resolved', { url: finalUrl })
    location.assign(finalUrl)
  }

  function setButtonState(button, state, message) {
    const textElement = button.querySelector('span.flex-label, span') || button
    const stateConfig = {
      waiting: { text: 'Please Wait...', color: 'orange' },
      downloading: { text: 'Downloading!', color: 'green' },
      error: { text: message || 'Error', color: 'red' }
    }
    const config = stateConfig[state] || stateConfig.error
    textElement.innerText = config.text
    button.style.color = config.color
  }

  function handleError(btn, error) {
    if (btn) setButtonState(btn, 'error', error)
    Logger.error('Download Error:', error)
    if (cfg.PlayErrorSound) playErrorSound()
    if (cfg.ShowAlertsOnError) alert(`Download error: ${error}`)
  }

  function attachClickInterceptor() {
    const extractFileId = href => {
      try {
        const url = new URL(href, location.href)
        const apiMatch = url.pathname.match(/\/api\/files\/(\d+)/)
        if (apiMatch) return apiMatch[1]
        return url.searchParams.get('file_id') || url.searchParams.get('id')
      } catch {
        /* empty */
      }
      return null
    }

    const IGNORE_ANCESTORS = 'nav, .nav, .pagination, .comment-container, .comment-content, .forum-post, .header-nav, .search-results, #nnwpp-btn'
    const DOWNLOAD_HREF_PATTERNS = ['/Core/Libs/Common/', 'tab=files&file_id=', 'file_id=', 'ModRequirementsPopUp', '/api/files/']
    const isDownloadHref = href => DOWNLOAD_HREF_PATTERNS.some(pattern => href.includes(pattern))

    document.body.addEventListener(
      'click',
      async function (event) {
        if (!isModPage() || !event.isTrusted) return

        if (cfg.SkipRequirements && event.composedPath) {
          const path = event.composedPath()
          const modal = path.find(n => n && n.tagName === 'DOWNLOAD-MODAL')
          if (modal) {
            const btn = path.find(n => n && (n.tagName === 'BUTTON' || n.tagName === 'A'))
            if (btn) {
              event.preventDefault()
              event.stopImmediatePropagation()
              const btnText = btn.textContent ? btn.textContent.toLowerCase() : ''
              const isNMM = btnText.includes('manager') || btnText.includes('vortex') || (btn.href && btn.href.includes('nmm=1'))
              let dlUrl = btn.href || btn.getAttribute('href')
              const linksStr = modal.getAttribute('download-links')
              if (linksStr) {
                try {
                  const links = JSON.parse(linksStr)
                  dlUrl = isNMM ? links.vortexDownloadUrl || links.downloadUrl : links.downloadUrl
                } catch {
                  /* empty */
                }
              }
              if (dlUrl) {
                logEvent('info', 'requirements:skipped', { isNMM, url: dlUrl })
                return startDownloadFlow({ btn, fileId: null, isNMM, href: dlUrl })
              }
            }
          }
        }

        const element = event.target.closest('a,button')
        if (!element || element.closest(IGNORE_ANCESTORS)) return

        const linkHref = element.href || element.getAttribute('href') || ''
        if (!linkHref || !isDownloadHref(linkHref)) return

        const fileId = extractFileId(linkHref)
        if (!fileId && !linkHref.includes('/api/files/')) return

        const hasRequirements = linkHref.includes('ModRequirementsPopUp') || linkHref.includes('tab=requirements')
        const isNMM = linkHref.includes('nmm=1') || linkHref.includes('&nmm') || element.closest('#action-nmm') !== null
        if (hasRequirements && !cfg.SkipRequirements) return

        event.preventDefault()
        event.stopImmediatePropagation()
        startDownloadFlow({ btn: element, fileId, isNMM, href: linkHref })
      },
      true
    )
  }

  function interceptRequirementsTab() {
    document.body.addEventListener(
      'click',
      function (event) {
        const linkElement = event.target.closest("a[href*='tab=requirements']")
        if (!linkElement || !cfg.SkipRequirements) return
        event.preventDefault()
        event.stopImmediatePropagation()
        const linkHref = linkElement.href || linkElement.getAttribute('href') || ''
        logEvent('debug', 'navigation:requirements-tab-intercepted')
        location.replace(linkHref.replace('tab=requirements', 'tab=files'))
      },
      true
    )
  }

  async function autoStartDownload() {
    if (!cfg.AutoStartDownload || !isModPage()) return
    const params = new URLSearchParams(location.search)
    const fileId = params.get('file_id')
    if (!fileId) return
    const isNMM = params.has('nmm') || params.get('nmm') === '1'
    await new Promise(r => setTimeout(r, 200))
    await startDownloadFlow({ fileId, isNMM, href: location.href, isAutoStart: true })
    if (cfg.AutoCloseTab) {
      logEvent('debug', 'tab:closing', { delay: cfg.CloseTabDelay })
      setTimeout(() => window.close(), cfg.CloseTabDelay)
    }
  }

  let upsellsHidden = false
  function upsellBlocker() {
    if (!cfg.HidePremiumUpsells || upsellsHidden) return
    upsellsHidden = true
    logEvent('debug', 'ui:upsell-blocker-active')
    const selectors = [
      '#nonPremiumBanner',
      '#freeTrialBanner',
      '#ig-banner-container',
      '#rj-vortex',
      '[class*="ads-bottom"]',
      '[class*="ads-top"]',
      '[class*="to-premium"]',
      '[class*="from-premium"]',
      '[class*="premium"]',
      '#mainContent > div.ads-holder.clearfix.ads-top',
      '#mainContent > div.ads-holder.clearfix.ads-bottom',
      '#mainContent > div > div.relative.next-container > div > section.flex.items-center.justify-center > div',
      '#mainContent > div > div.relative.next-container > div > a',
      '#headlessui-menu-items-_r_ap_ > div.flex.flex-col.gap-y-4.px-3.py-2 > div.hidden.md\\:block',
      '#head > div.rj-right-tray.rj-profile-tray.rj-open > ul > li.user-profile-menu-section-top > a',
      '#mainContent > div.flex.items-center.justify-center.gap-x-4.border-y.border-stroke-subdued.bg-surface-low.py-2',
      '#mainContent > div.hidden.items-center.justify-center.gap-x-4.border-b.border-stroke-subdued.bg-surface-low.py-2.md\\:flex',
      '#mainContent > div.relative > div.relative.next-container.pb-20 > div.space-y-16 > div.relative.overflow-hidden.rounded-lg.border-2.border-\\[\\#FCD23F\\]',
      '#mainContent > div.relative > div.relative.next-container.pb-20 > div.mb-6.w-full.space-y-6.border-b.border-stroke-weak.pt-4.pb-6.sm\\:mb-0.sm\\:border-none.sm\\:pb-8 > section > div.flex.flex-col.gap-2.rounded-sm.bg-surface-translucent-low.p-2.5.backdrop-blur-xs.xs\\:w-fit.xs\\:max-w-sm.order-4.h-fit.w-full',
      '#filters-panel > div.mt-4.hidden.rounded-lg.border.border-creator-subdued.bg-creator-weak.bg-cover.p-4'
    ]
    GM_addStyle(selectors.map(s => `${s}{display:none!important}`).join('\n'))

    const modFileDownloadElement = document.querySelector('mod-file-download')
    if (modFileDownloadElement?.shadowRoot) {
      const shadowStyle = document.createElement('style')
      shadowStyle.textContent = '#upsell-cards > div.relative.flex.flex-col.justify-between.gap-y-6.rounded-lg.border.bg-gradient-to-t.from-premium-weak.from-25\\%.to-premium-900.to-75\\%.p-6.sm\\:order-last.border-premium-100.border-premium-moderate{display:none!important}'
      modFileDownloadElement.shadowRoot.appendChild(shadowStyle)
    }
    document.querySelector('.bg-nexus-premium-gradient')?.remove()
  }

  function waitForElement(selector, cb) {
    const el = document.querySelector(selector)
    if (el) return cb(el)
    const mo = new MutationObserver(() => {
      const target = document.querySelector(selector)
      if (target) {
        mo.disconnect()
        cb(target)
      }
    })
    mo.observe(document.body, { childList: true, subtree: true })
  }

  function archivedFileHandler() {
    if (!cfg.HandleArchivedFiles || !isModPage()) return
    const url = location.href
    if (url.includes('tab=files') && !url.includes('category=archived')) {
      waitForElement('#files-tab-footer', footer => {
        footer.querySelector('p')?.style.setProperty('display', 'none')
        const hasArchiveBtn = Array.from(footer.querySelectorAll('a.btn.inline-flex .flex-label')).some(el => el.textContent.trim() === 'File archive')
        if (!hasArchiveBtn) {
          logEvent('debug', 'ui:archive-button-restored')
          footer.insertAdjacentHTML('beforeend', `<a class="btn inline-flex" data-archived-btn="true" href="${url}&category=archived" style="background:#da8e35;color:#fff;margin-left:8px;"><span class="flex-label">File archive</span></a>`)
        }
      })
    }
    if (!url.includes('category=archived')) return
    const headers = document.getElementsByClassName('file-expander-header')
    const downloads = document.getElementsByClassName('accordion-downloads')
    const base = location.origin + location.pathname
    for (let i = 0; i < headers.length; i++) {
      const fileId = headers[i]?.dataset?.id
      const box = downloads[i]
      if (!fileId || !box || box.dataset.done) continue
      box.dataset.done = '1'
      const safeId = encodeURIComponent(fileId)
      box.innerHTML = `
        <a class="btn inline-flex" href="${base}?tab=files&file_id=${safeId}&nmm=1"><span class="flex-label">Mod manager download</span></a>
        <a class="btn inline-flex" href="${base}?tab=files&file_id=${safeId}"><span class="flex-label">Manual download</span></a>
      `
    }
  }

  function forceModManagerHandler() {
    if (forceNmmObserver) {
      forceNmmObserver.disconnect()
      forceNmmObserver = null
    }
    if (!cfg.ForceModManagerDownload || !isModPage()) return

    const injectManagerButtons = () => {
      const manualLinks = document.querySelectorAll('a[href*="file_id="]:not([href*="nmm=1"]), a.btn[href*="tab=files"]:not([href*="nmm=1"])')

      for (const link of manualLinks) {
        if (link.dataset.nnwppForcedNmm) continue

        const text = (link.textContent || link.getAttribute('aria-label') || '').toLowerCase()
        if (!text.includes('manual')) continue

        // look deep in the DOM to find sibling buttons
        let hasManagerLink = false
        let searchArea = link.parentElement

        for (let i = 0; i < 3; i++) {
          if (!searchArea) break

          for (const el of searchArea.querySelectorAll('a, button')) {
            if (el === link || el.dataset.nnwppForcedNmm) continue
            const t = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase()
            if ((el.href && el.href.includes('nmm=1')) || t.includes('manager') || t.includes('vortex')) {
              hasManagerLink = true
              break
            }
          }

          if (hasManagerLink) break
          searchArea = searchArea.parentElement // move up one level and check again
        }

        if (hasManagerLink) {
          link.dataset.nnwppForcedNmm = 'true' // to skip re checking
          continue
        }

        link.dataset.nnwppForcedNmm = 'true'
        const isLi = link.parentElement && link.parentElement.tagName === 'LI'
        const nodeToClone = isLi ? link.parentElement : link
        const clone = nodeToClone.cloneNode(true)
        const managerLink = isLi ? clone.querySelector('a') : clone

        if (managerLink.href.includes('file_id=')) {
          try {
            const nmmUrl = new URL(managerLink.href, location.origin)
            nmmUrl.searchParams.set('nmm', '1')
            managerLink.href = nmmUrl.toString()
          } catch {
            managerLink.href += (managerLink.href.includes('?') ? '&' : '?') + 'nmm=1'
          }
        }

        const label = managerLink.querySelector('.flex-label') || managerLink
        label.textContent = text.includes('download') ? '(NNW++) Mod manager download' : '(NNW++) Mod manager'
        nodeToClone.parentNode.insertBefore(clone, nodeToClone)
      }
    }

    injectManagerButtons()
    forceNmmObserver = new MutationObserver(injectManagerButtons)
    forceNmmObserver.observe(document.body, { childList: true, subtree: true })
  }

  function main() {
    setupAudio()
    SettingsUI()
    if (!listenersAttached) {
      attachClickInterceptor()
      interceptRequirementsTab()
      listenersAttached = true
    }
    autoStartDownload()
    upsellBlocker()
    archivedFileHandler()
    forceModManagerHandler()

    if (slowDownloadObserver) {
      slowDownloadObserver.disconnect()
      slowDownloadObserver = null
    }
    if (location.search.includes('file_id')) {
      const setupSlowDownloadIntercept = () => {
        const modFileDownload = document.querySelector('mod-file-download')
        if (modFileDownload?.shadowRoot) {
          const slowDownloadBtn = modFileDownload.shadowRoot.querySelector('#upsell-cards > div.flex.flex-col.justify-between.gap-y-6.rounded-lg.bg-surface-translucent-low.p-6 > button')
          if (slowDownloadBtn && !slowDownloadBtn.dataset.nnwppAttached) {
            slowDownloadBtn.dataset.nnwppAttached = 'true'
            slowDownloadBtn.addEventListener('click', async event => {
              event.preventDefault()
              event.stopImmediatePropagation()
              const fid = new URLSearchParams(location.search).get('file_id')
              if (!fid) return
              const isNMM = location.search.includes('nmm=1') || location.search.includes('&nmm')
              logEvent('debug', 'download:slow-intercept', { fileId: fid, isNMM })
              await startDownloadFlow({ btn: slowDownloadBtn, fileId: fid, isNMM, href: location.href })
            })
          }
        }
      }
      setupSlowDownloadIntercept()
      slowDownloadObserver = new MutationObserver(setupSlowDownloadIntercept)
      slowDownloadObserver.observe(document.body, { childList: true, subtree: true })
    }

    logEvent('info', 'init', { url: location.href })
  }

  function SettingsUI() {
    const SETTING_UI = [
      { key: 'AutoStartDownload', label: 'Auto Start Download on file_id= URLs', type: 'bool', description: 'Automatically start downloads when visiting file download pages (URLs containing file_id=)' },
      { key: 'AutoCloseTab', label: 'Auto-Close Tab After AutoStartDownload', type: 'bool', description: 'Auto-close may be unreliable due to browser permissions.', showIf: () => cfg.AutoStartDownload },
      { key: 'SkipRequirements', label: 'Skip Requirements PopUp/Tab', type: 'bool', description: 'Skip the requirements popup/page and proceed directly to download' },
      { key: 'ShowAlertsOnError', label: 'Show Alert Messages on Errors', type: 'bool', description: 'Display error messages as browser popup alerts' },
      { key: 'PlayErrorSound', label: 'Play Error Sound', type: 'bool', description: 'Play an error sound when download errors occur' },
      { key: 'HidePremiumUpsells', label: 'Hide Premium Upsells & misc Annoyances (experimental)', type: 'bool', description: 'Hide premium upgrade banners, trial offers, and other annoyances on the site (experimental). You are probably better off using an adblocker.' },
      { key: 'RequestTimeout', label: 'Request Timeout', type: 'number', description: 'Maximum time to wait for server responses before timing out (in milliseconds)' },
      { key: 'CloseTabDelay', label: 'Auto-Close Tab Delay', type: 'number', description: 'Delay before automatically closing the tab after download starts (in milliseconds)', showIf: () => cfg.AutoCloseTab },
      { key: 'ErrorSoundUrl', label: 'Error Sound URL', type: 'text', description: 'URL of the custom sound file to play for error alerts', showIf: () => cfg.PlayErrorSound },
      { key: 'ForceModManagerDownload', label: 'Generate mod manager download buttons for manual-only downloads', type: 'bool', description: "Inject mod-manager download buttons on files that don't have any." },
      { key: 'HandleArchivedFiles', label: 'Generate download buttons for Archived Files', type: 'bool', description: 'Enable handling of archived files.' }
    ]
    const STYLES = {
      btn: "position:fixed;bottom:20px;right:20px;background:#2f2f2f;color:#fff;padding:10px 15px;border-radius:4px;cursor:pointer;z-index:9999;font-family:'Inter','Helvetica Neue', Helvetica, Arial, sans-serif;font-size:14px;border:none;",
      modal: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#2f2f2f;color:#dadada;padding:25px;border-radius:4px;z-index:10000;min-width:300px;max-width:90%;max-height:90vh;overflow-y:auto;font-family:'Inter','Helvetica Neue', Helvetica, Arial, sans-serif;",
      backdrop: 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:9999;',
      section: 'background:#363636;padding:15px;border-radius:4px;margin-bottom:15px;',
      sectionHeader: 'color:#da8e35;margin:0 0 10px 0;font-size:16px;font-weight:500;',
      input: 'background:#2f2f2f;border:1px solid #444;color:#dadada;border-radius:3px;padding:5px;',
      row: 'margin-bottom:10px;',
      label: 'display:flex;align-items:center;gap:8px;',
      btnObj: {
        primary: 'padding:8px 15px;border:none;background:#da8e35;color:white;border-radius:3px;cursor:pointer;',
        secondary: 'padding:8px 15px;border:1px solid #da8e35;background:transparent;color:#da8e35;border-radius:3px;cursor:pointer;',
        advanced: 'padding:4px 8px;background:transparent;color:#666;border:none;cursor:pointer;',
        closeX: 'position:absolute;top:10px;right:10px;background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;padding:5px;'
      }
    }

    function save() {
      try {
        GM_setValue(CONFIG_KEY, JSON.stringify(cfg))
        logEvent('debug', 'config:saved')
      } catch (e) {
        Logger.error('Failed to save config:', e)
      }
    }

    let activeModal = null
    let activeBackdrop = null

    function closeModal() {
      activeModal?.remove()
      activeModal = null
      activeBackdrop?.remove()
      activeBackdrop = null
      document.removeEventListener('keydown', onSettingsKeyDown)
    }

    const onSettingsKeyDown = event => {
      if (event.key === 'Escape') closeModal()
    }

    function showSettingsModal() {
      cfg = loadConfig()
      closeModal()

      const backdrop = document.createElement('div')
      backdrop.style.cssText = STYLES.backdrop
      backdrop.onclick = closeModal
      document.body.appendChild(backdrop)
      activeBackdrop = backdrop

      const modal = document.createElement('div')
      modal.style.cssText = STYLES.modal

      const build = setting => {
        const shouldShow = !setting.showIf || setting.showIf()
        if (setting.type === 'bool') return `<div style="${STYLES.row};display:${shouldShow ? 'block' : 'none'}"><label title="${setting.description}" style="${STYLES.label}"><input type="checkbox" data-setting="${setting.key}" ${cfg[setting.key] ? 'checked' : ''}><span>${setting.label}</span></label></div>`
        if (setting.type === 'number') {
          const step = setting.key === 'CloseTabDelay' ? 100 : 1
          return `<div style="${STYLES.row};display:${shouldShow ? 'block' : 'none'}"><label title="${setting.description}" style="${STYLES.label}"><span>${setting.label}:</span><input type="number" value="${cfg[setting.key]}" min="0" step="${step}" data-setting="${setting.key}" style="${STYLES.input};width:120px;"></label></div>`
        }
        if (setting.type === 'text') return `<div style="${STYLES.row};display:${shouldShow ? 'block' : 'none'}"><label title="${setting.description}" style="${STYLES.label}"><span style="font-size:0.9em;color:#aaa;">${setting.label}:</span><input type="text" value="${cfg[setting.key]}" data-setting="${setting.key}" style="${STYLES.input};width:95%;"></label></div>`
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
        <div style="text-align:center;margin-top:10px;color:#888;font-size:11px;">Some changed settings may require a page reload to take effect.</div>
        <div style="text-align:center;margin-top:12px;color:#666;font-size:12px;">v${GM_info.script.version} by Torkelicious</div>
        <div style="text-align:center;margin-top:6px;color:#666;font-size:10px;"><a href="https://github.com/torkelicious/nexus-no-wait-pp/" target="_blank" style="color:#666;">This software is open-source and licensed under the GPLv3</a></div>
      `

      const update = element => {
        const key = element.getAttribute('data-setting')
        if (!key) return
        let value = element.type === 'checkbox' ? element.checked : element.type === 'number' ? parseInt(element.value, 10) : element.value
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
        if ((event.target.type === 'number' || event.target.type === 'text') && event.target?.hasAttribute('data-setting')) update(event.target)
      })

      modal.querySelector('#closeSettingsX').addEventListener('click', closeModal)
      modal.querySelector('#closeSettings').addEventListener('click', closeModal)
      modal.querySelector('#resetSettings').addEventListener('click', () => {
        cleanResetConfig()
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
      btn.onmouseout = () => (btn.style.transform = 'none')
      document.body.appendChild(btn)
      const observer = new MutationObserver(() => {
        if (!document.getElementById('nnwpp-btn')) document.body.appendChild(btn)
      })
      observer.observe(document.body, { childList: true, subtree: true })
    }
  }

  main()

  let lastUrl = location.href
  const originalPushState = history.pushState
  const originalReplaceState = history.replaceState

  function onNavigate() {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      main()
    }
  }
  history.pushState = function (...args) {
    originalPushState.apply(this, args)
    onNavigate()
  }
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args)
    onNavigate()
  }
  window.addEventListener('popstate', onNavigate)
})()
