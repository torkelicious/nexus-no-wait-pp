// ==UserScript==
// @name        Nexus No Wait ++
// @description Skip Countdown, Auto Download, and More for Nexus Mods. Supports (Manual/Vortex/MO2/NMM)
// @version     2.2.2
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
// @grant       GM_registerMenuCommand
// @grant       GM_download
// @connect     *.nexusmods.com
// @connect     files.nexus-cdn.com
// @connect     *.nexus-cdn.com
// @connect     raw.githubusercontent.com
// ==/UserScript==

;(function () {
    'use strict'

    // config / state
    const CONFIG_KEY = 'NexusNoWaitPP'
    const AUDIO_CACHE_KEY = 'NexusNoWaitPP_ErrorSoundCache'
    const DEFAULTS = { AutoStartDownload: true, AutoCloseTab: true, SkipRequirements: true, ShowAlertsOnError: true, PlayErrorSound: true, ErrorSoundUrl: 'https://github.com/torkelicious/nexus-no-wait-pp/raw/cf4fdca1cde74a173ac115e95eb1c8ffeb19a4ae/errorsound.mp3', HandleArchivedFiles: true, HidePremiumUpsells: false, OverrideFileNames: false, ForceModManagerDownload: false, CloseTabDelay: 2000, RequestTimeout: 30000 }

    function loadConfig() {
        try {
            let raw = typeof GM_getValue === 'function' ? GM_getValue(CONFIG_KEY, null) : null
            if (typeof raw === 'string') raw = JSON.parse(raw)
            const parsed = { ...DEFAULTS, ...(raw || {}) }
            logEvent('debug', 'config:load', { activeConfig: parsed })
            return parsed
        } catch (e) {
            Logger.warn('Failed to load config, using defaults', e)
            return { ...DEFAULTS }
        }
    }

    function cleanResetConfig() {
        logEvent('info', 'config:reset-requested')
        Object.assign(cfg, DEFAULTS)
        if (typeof GM_setValue === 'function') GM_setValue(CONFIG_KEY, JSON.stringify(cfg))
        location.reload()
    }

    // logging
    const Logger = ['debug', 'info', 'warn', 'error'].reduce((o, lvl) => {
        o[lvl] = (...a) => console[lvl](`[NexusNoWait++ v${GM_info.script.version}]`, ...a)
        return o
    }, {})
    const logEvent = (level, event, data = {}) => Logger[level](event, data)

    let cfg = loadConfig()

    // prevent duplicate actions & state tracking
    const processing = new WeakSet(),
        handledArchive = new WeakSet(),
        handledForceNmm = new WeakSet(),
        attachedSlowDl = new WeakSet()
    const autoFiredIds = new Set()
    let listenersAttached = false,
        errorAudioPlayer = null,
        stylesInjected = false,
        domObserver = null,
        domUpdateTimeout = null

    // network setup
    const gmXmlHttpRequest = typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest.bind(GM) : typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null
    if (!gmXmlHttpRequest) Logger.error('No GM XHR API available. Script may not function correctly.')
    function gmRequest(url, opts = {}) {
        return new Promise(resolve => {
            if (!gmXmlHttpRequest) return resolve({ text: '', finalUrl: '', headers: '', status: 0 })
            const done = r => resolve({ text: r?.responseText || '', finalUrl: r?.finalUrl || '', headers: r?.responseHeaders || '', status: r?.status || 0 })
            gmXmlHttpRequest({
                method: opts.method || 'GET',
                ...opts,
                url,
                timeout: opts.timeout ?? cfg.RequestTimeout,
                headers: opts.headers || {},
                data: opts.data || null,
                onload: done,
                onerror: e => {
                    logEvent('error', 'network:failed', { url, e })
                    done()
                },
                ontimeout: () => {
                    logEvent('warn', 'network:timeout', { url })
                    done()
                }
            })
        })
    }

    function isCloudflareChallenge(res) {
        if (!res?.text) return false
        if (/cf-turnstile|challenges\.cloudflare\.com|Just a moment|Attention Required!|cf-error-details|id="challenge-form"|cf-browser-verification|window\._cf_chl_opt/i.test(res.text)) return true
        return (res.status === 403 || res.status === 503) && /cf-ray|server:\s*cloudflare/i.test(res.headers) && res.text.trim().startsWith('<')
    }

    // audio setup
    function initAudioPlayer(src) {
        errorAudioPlayer = new Audio(src)
        errorAudioPlayer.preload = 'auto'
        errorAudioPlayer.load()
    }

    function setupAudio() {
        if (!cfg.PlayErrorSound || !cfg.ErrorSoundUrl || errorAudioPlayer) return
        const cached = typeof GM_getValue === 'function' ? GM_getValue(AUDIO_CACHE_KEY, null) : null
        if (cached) return initAudioPlayer(cached)

        if (!gmXmlHttpRequest) return initAudioPlayer(cfg.ErrorSoundUrl)
        gmXmlHttpRequest({
            method: 'GET',
            url: cfg.ErrorSoundUrl,
            responseType: 'blob',
            onload: res => {
                if (res.status >= 200 && res.status < 300 && res.response) {
                    const reader = new FileReader()
                    reader.onloadend = () => {
                        if (typeof GM_setValue === 'function') GM_setValue(AUDIO_CACHE_KEY, reader.result)
                        initAudioPlayer(reader.result)
                    }
                    reader.readAsDataURL(res.response)
                } else initAudioPlayer(cfg.ErrorSoundUrl)
            },
            onerror: () => initAudioPlayer(cfg.ErrorSoundUrl),
            ontimeout: () => initAudioPlayer(cfg.ErrorSoundUrl)
        })
    }

    const playErrorSound = () => {
        if (errorAudioPlayer) {
            errorAudioPlayer.currentTime = 0
            errorAudioPlayer.play().catch(e => Logger.warn('Audio err:', e))
        }
    }

    // DOM & parsing utils
    const escapeAttr = str => String(str).replace(/[&"'<>]/g, m => ({ '&': '&amp;', '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;' })[m])
    const sanitizeFilename = name => (name ? String(name).replace(/\\/g, '/').split('/').pop().replace(/^\.+/, '').trim() || 'nexus_download' : name)
    const appendNmmParam = href => (!href || href.includes('nmm=1') ? href : `${href}${href.includes('?') ? '&' : '?'}nmm=1`)
    const isModPage = () => /\/mods\/\d+/.test(location.pathname)
    const REQUIREMENTS_URL_PATTERN = /ModRequirementsPopUp|tab=requirements/i
    const isRequirementsUrl = href => REQUIREMENTS_URL_PATTERN.test(href)

    function isNMMDownload(el, href = '') {
        if (href && (href.startsWith('nxm://') || href.includes('nmm=1') || href.includes('&nmm=1'))) return true
        if (!el) return false
        if (el.dataset?.nnwppIsNmm !== undefined) return el.dataset.nnwppIsNmm === '1'
        if (el.id === 'action-vortex' || el.id === 'action-nmm') return true
        return /(vortex|mod manager|manager download)/i.test((el.textContent || el.getAttribute('aria-label') || '').toLowerCase())
    }

    function getGameId(el = null) {
        while (el) {
            if (['MOD-DOWNLOAD-BUTTONS', 'MOD-FILE-DOWNLOAD'].includes(el.tagName) && el.getAttribute('game-id')) return el.getAttribute('game-id')
            el = el.parentNode || (el instanceof ShadowRoot ? el.host : null)
        }
        const dataEl = document.querySelector('[data-game-id], [game-id]')
        if (dataEl) return dataEl.dataset.gameId || dataEl.getAttribute('game-id')
        for (const script of document.querySelectorAll('script')) {
            const m = script.textContent.match(/game_id\s*:\s*(\d+)/) || script.textContent.match(/gameId\s*:\s*(\d+)/)
            if (m) return m[1]
        }
        return document.getElementById('section')?.dataset?.gameId || location.pathname.split('/')[1] || ''
    }

    function parseDownloadURLFromResponse(text) {
        if (!text) return null
        try {
            const j = JSON.parse(String(text))
            if (j?.url) return { url: j.url.replace(/&amp;/g, '&') }
        } catch (e) {}
        const m = String(text).match(/id=["']dl_link["'][^>]*value=["']([^"']+)["']/i)
        return m ? { url: m[1].replace(/&amp;/g, '&') } : null
    }

    function parseDownloadLink(text) {
        if (!text) return null
        const m = String(text)
            .replace(/&amp;/g, '&')
            .replace(/\\\//g, '/')
            .match(/nxm:\/\/[^\s"'<>]+/i)
        if (!m || !m[0].includes('?')) return null
        const p = new URLSearchParams(m[0].slice(m[0].indexOf('?') + 1))
        return p.has('key') && p.has('expires') && p.has('user_id') ? m[0] : null
    }

    function getFilenameFromHead(h) {
        if (!h) return null
        if (typeof h === 'object') h = h['content-disposition'] || h['Content-Disposition'] || ''
        const m = String(h).match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i)
        return m?.[1] ? m[1].replace(/['"]/g, '').trim() : null
    }

    // requirements detection
    function readRequirementsFlag(el) {
        if (!el?.getAttribute) return null
        let saw = false,
            has = false,
            err = false
        const check = (attr, isDep) => {
            const val = el.getAttribute(attr)
            if (val == null) return
            saw = true
            try {
                const p = JSON.parse(val)
                if (Array.isArray(p) && (isDep ? p.some(g => g?.files?.length > 0) : p.length > 0)) has = true
            } catch {
                err = true
            }
        }
        check('requirements', false)
        check('dependencies', true)
        if (!saw) return false
        if (has) return true
        return err ? null : false
    }

    function detectRequirements(elements) {
        let defFalse = false,
            candidate = false
        for (const el of elements) {
            if (!el) continue
            candidate = true
            const flag = readRequirementsFlag(el)
            if (flag === true) return { hasRequirements: true, unknown: false }
            if (flag === false) defFalse = true
        }
        return { hasRequirements: false, unknown: !defFalse && candidate }
    }

    // download resolution
    async function getDownloadUrl({ fileId, gameId, isNMM, href }) {
        if (!fileId && !href) return { url: null, error: 'Missing fileId' }
        if (href?.startsWith('nxm://')) return { url: href }

        const extract = r => r.headers.match(/Location:\s*(nxm:\/\/[^\s]+)/i)?.[1] || parseDownloadURLFromResponse(r.text)?.url || parseDownloadLink(r.text) || parseDownloadLink(r.finalUrl)

        if (href?.includes('/api/files/')) {
            const target = isNMM ? appendNmmParam(href) : href
            const res = await gmRequest(target, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            if (isCloudflareChallenge(res)) return { url: null, error: 'cloudflare-challenge' }
            const link = (res.finalUrl && res.finalUrl !== target ? res.finalUrl : null) || extract(res)
            if (link) return { url: link }
        }

        if (isNMM && href) {
            const target = appendNmmParam(href)
            const res = await gmRequest(target, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            if (isCloudflareChallenge(res)) return { url: null, error: 'cloudflare-challenge' }
            let link = extract(res)
            if (!link && isRequirementsUrl(target)) {
                const rm = res.text.match(/href=["']([^"']*?file_id[^"']*?)["']/i)
                if (rm) link = extract(await gmRequest(rm[1]))
            }
            if (link) return { url: link }
        }

        if (fileId) {
            const spoof = `https://www.nexusmods.com${location.pathname}?tab=files&file_id=${fileId}`
            const res = await gmRequest('/Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl', { method: 'POST', data: `fid=${encodeURIComponent(fileId)}&game_id=${encodeURIComponent(gameId || '')}${isNMM ? '&nmm=1' : ''}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Origin: 'https://www.nexusmods.com', Referer: href || spoof } })
            if (isCloudflareChallenge(res)) return { url: null, error: 'cloudflare-challenge' }
            const link = parseDownloadURLFromResponse(res.text)?.url
            if (link) return { url: link }
        }
        return { url: null, error: 'Could not resolve file link (are you logged in?)' }
    }

    async function normalizeDownloadUrl(url, isNMM) {
        if (!url || url.startsWith('nxm://')) return url
        if (url.includes('nexusmods.com') && url.includes('file_id=')) {
            try {
                const fileId = new URL(url, location.href).searchParams.get('file_id')
                if (fileId) return (await getDownloadUrl({ fileId, gameId: getGameId(), isNMM, href: url }))?.url || url
            } catch (e) {}
        }
        return url
    }

    async function scrapeDeepDownloadLink(pageUrl, isNMM) {
        try {
            const res = await gmRequest(pageUrl)
            const re = /(?:main-file|file)=(["'])(.*?)\1/gi
            let m
            while ((m = re.exec(res.text)) !== null) {
                try {
                    const u = m[2]
                        .replace(/&quot;/g, '"')
                        .replace(/&amp;/g, '&')
                        .replace(/&#34;/g, '"')
                    if (!u.includes('downloadUrl')) continue
                    const fd = JSON.parse(u)
                    if (isNMM ? fd.vortexDownloadUrl || fd.downloadUrl : fd.downloadUrl) return isNMM ? fd.vortexDownloadUrl || fd.downloadUrl : fd.downloadUrl
                } catch (e) {}
            }
            return res.text.match(/https?:\/\/[a-zA-Z0-9-]+\.nexus-cdn\.com[^"']+/i)?.[0].replace(/&amp;/g, '&') || null
        } catch {
            return null
        }
    }

    // button state & execution
    function setButtonState(btn, state, msg) {
        if (!btn) return
        const txtEl = btn.querySelector('span.flex-label, span') || btn
        const sc = { waiting: { text: 'Please Wait...', color: 'orange' }, downloading: { text: 'Downloading!', color: 'green' }, error: { text: msg || 'Error', color: 'red' } }
        if (txtEl && btn.dataset?.nnwppOrigText === undefined) {
            btn.dataset.nnwppOrigText = txtEl.innerText
            btn.dataset.nnwppOrigColor = btn.style.color || ''
        }
        if (txtEl) txtEl.innerText = (sc[state] || sc.error).text
        btn.style.color = (sc[state] || sc.error).color
    }

    function restoreButtonState(btn, delay = 4000) {
        if (!btn?.dataset?.nnwppOrigText) return
        setTimeout(() => {
            const txtEl = btn.querySelector('span.flex-label, span') || btn
            if (txtEl) txtEl.innerText = btn.dataset.nnwppOrigText
            btn.style.color = btn.dataset.nnwppOrigColor || ''
        }, delay)
    }

    function handleError(btn, error) {
        const msg = { 'cloudflare-challenge': 'Nexus is showing a security check (Cloudflare) instead of the real response. Disable your VPN or clear it manually in a normal tab.' }[error] || error
        if (btn) setButtonState(btn, 'error', msg)
        Logger.error('Download Error:', msg)
        if (cfg.PlayErrorSound) playErrorSound()
        if (cfg.ShowAlertsOnError) alert(`Download error: ${msg}`)
    }

    async function startDownloadFlow({ btn, fileId, isNMM, href, isAutoStart = false }) {
        if (btn) setButtonState(btn, 'waiting')
        logEvent('debug', isAutoStart ? 'download:auto-start' : 'download:start', { fileId, isNMM, href })
        const gameId = getGameId(btn)

        const { url, error } = await getDownloadUrl({ fileId, gameId, isNMM, href })
        if (error) return handleError(btn || null, error)

        if (btn) setButtonState(btn, 'downloading')
        let finalUrl = await normalizeDownloadUrl(url, isNMM)
        if (!finalUrl) return handleError(btn || null, 'Failed to resolve download URL')

        if (isRequirementsUrl(finalUrl) && !cfg.SkipRequirements) {
            logEvent('info', 'Halting flow: File has requirements & SkipRequirements is false', { finalUrl })
            return location.assign(finalUrl)
        }

        if (cfg.SkipRequirements && !finalUrl.startsWith('nxm://') && finalUrl.includes('nexusmods.com') && (finalUrl.includes('file_id=') || /\/files\/\d+/i.test(finalUrl)) && !finalUrl.includes('GenerateDownloadUrl') && !finalUrl.includes('nexus-cdn.com')) {
            const dl = await scrapeDeepDownloadLink(finalUrl, isNMM)
            if (dl) finalUrl = dl.includes('/api/files/') || dl.includes('GenerateDownloadUrl') ? (await getDownloadUrl({ href: dl, gameId, isNMM }))?.url || dl : dl
        }

        if (cfg.OverrideFileNames && typeof GM_download === 'function' && !isNMM && !finalUrl.startsWith('nxm://')) {
            const modId = location.pathname.match(/\/mods\/(\d+)/)?.[1]
            if (modId) {
                let name = sanitizeFilename(decodeURIComponent(finalUrl.split('/').pop().split('?')[0])) || 'nexus_download'
                if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name) || !name.includes('.')) {
                    try {
                        const h = await gmRequest(finalUrl, { method: 'HEAD' })
                        const rName = sanitizeFilename(getFilenameFromHead(h.headers))
                        if (rName) name = rName
                        else throw new Error('No real name')
                    } catch (err) {
                        logEvent('warn', 'download: override fallback', err)
                        location.assign(finalUrl)
                        return btn && restoreButtonState(btn)
                    }
                }
                const ext = name.lastIndexOf('.'),
                    idRegex = new RegExp(`(^|[^0-9])${modId}([^0-9]|$)`)
                let nName = idRegex.test(name) ? name : ext !== -1 ? `${name.substring(0, ext)}-${modId}${name.substring(ext)}` : `${name}-${modId}`
                GM_download({
                    url: finalUrl,
                    name: nName,
                    saveAs: false,
                    onload: () => btn && restoreButtonState(btn),
                    onerror: () => {
                        location.assign(finalUrl)
                        btn && restoreButtonState(btn)
                    }
                })
                return
            }
        }
        location.assign(finalUrl)
        if (btn) restoreButtonState(btn)
    }

    // click interception
    const isDownloadHref = href => isRequirementsUrl(href) || ['tab=files&file_id=', 'file_id=', '/api/files/', 'nxm://'].some(p => href.toLowerCase().includes(p.toLowerCase()))

    function extractFileId(href) {
        try {
            const u = href.startsWith('nxm://') ? new URLSearchParams(href.substring(href.indexOf('?'))) : new URL(href, location.href).searchParams
            return u.get('id') || u.get('file_id') || new URL(href, location.href).pathname.match(/\/api\/files\/(\d+)/)?.[1] || null
        } catch {
            return null
        }
    }

    function attachClickInterceptor() {
        document.body.addEventListener(
            'click',
            async event => {
                if (!isModPage() || !event.isTrusted || event.defaultPrevented) return
                const path = event.composedPath ? event.composedPath() : [event.target]
                const el = path.find(n => n?.tagName === 'A' || n?.tagName === 'BUTTON') || event.target.closest('a,button')
                if (!el || el.closest('.pagination, .comment-container, .comment-content, .forum-post, .search-results, #nnwpp-btn')) return

                const href = el.getAttribute('href') || el.href || ''
                if (el.classList.contains('popup-btn-ajax') && !isRequirementsUrl(href)) return
                if (href.includes('tab=files') && !href.includes('file_id=')) return

                const isNMM = isNMMDownload(el, href)
                if (el.dataset?.nnwppIsNmm === undefined) el.dataset.nnwppIsNmm = isNMM ? '1' : '0'

                let fileId = extractFileId(href),
                    secureApiUrl = null
                let modal = path.find(n => n?.tagName === 'MOD-DOWNLOAD-MODAL') || path.find(n => n?.shadowRoot?.querySelector('mod-download-modal'))?.shadowRoot.querySelector('mod-download-modal') || path.find(n => ['MOD-DOWNLOAD-BUTTONS', 'MOD-FILE-DOWNLOAD'].includes(n?.tagName))?.querySelector('mod-download-modal')

                if (modal) {
                    try {
                        const fd = JSON.parse(modal.getAttribute('file') || '{}')
                        if (fd.downloadUrl) secureApiUrl = isNMM ? fd.vortexDownloadUrl || fd.downloadUrl : fd.downloadUrl
                    } catch (e) {}
                }

                const hostContainer = path.find(n => ['MOD-DOWNLOAD-BUTTONS', 'MOD-FILE-DOWNLOAD'].includes(n?.tagName))
                if (!secureApiUrl && hostContainer) {
                    try {
                        const fd = JSON.parse(hostContainer.getAttribute(hostContainer.tagName === 'MOD-DOWNLOAD-BUTTONS' ? 'main-file' : 'file') || '{}')
                        if (fd.id && !fileId) fileId = fd.id.toString()
                    } catch (e) {}
                }

                const { hasRequirements: reqAlert, unknown: reqUnknown } = detectRequirements([modal, hostContainer])
                const reqHref = isRequirementsUrl(href)

                if (!(fileId || secureApiUrl || isDownloadHref(href) || (modal && (isNMM || (el.textContent || '').toLowerCase().includes('manual'))))) return
                if ((reqAlert || reqHref || reqUnknown) && !cfg.SkipRequirements) return logEvent('info', 'Yielding to native UI: Requirements active/unknown')
                if (processing.has(el) || (el.textContent || '').toLowerCase().includes('slow download')) return

                processing.add(el)
                event.preventDefault()
                event.stopImmediatePropagation()
                try {
                    await startDownloadFlow({ btn: el, fileId: secureApiUrl ? null : fileId, isNMM, href: secureApiUrl || href || `https://www.nexusmods.com${location.pathname}?tab=files&file_id=${fileId}` })
                } catch (e) {
                    handleError(el, String(e))
                } finally {
                    processing.delete(el)
                }
            },
            true
        )
    }

    function interceptRequirementsTab() {
        document.body.addEventListener(
            'click',
            e => {
                if (!e.isTrusted || e.defaultPrevented || !cfg.SkipRequirements) return
                const link = e.composedPath ? e.composedPath().find(n => n?.tagName === 'A') : e.target.closest('a')
                if (!link?.href?.includes('tab=requirements')) return
                e.preventDefault()
                e.stopImmediatePropagation()
                location.replace(link.href.replace('tab=requirements', 'tab=files'))
            },
            true
        )
    }

    // features
    async function autoStartDownload() {
        if (!cfg.AutoStartDownload || !isModPage() || (location.search.includes('tab=files') && !location.pathname.includes('/files/')) || document.querySelector('mod-file-download')) return
        const fileId = new URLSearchParams(location.search).get('file_id')
        if (!fileId || autoFiredIds.has(fileId)) return
        autoFiredIds.add(fileId)

        await new Promise(r => setTimeout(r, 200))
        await startDownloadFlow({ fileId, isNMM: isNMMDownload(null, location.search), href: location.href, isAutoStart: true })
        if (cfg.AutoCloseTab) setTimeout(() => window.close(), cfg.CloseTabDelay)
    }

    function setupSlowDownloadIntercept() {
        const fid = new URLSearchParams(location.search).get('file_id')
        if (!fid) return
        const slowBtn = document.querySelector('mod-file-download')?.shadowRoot?.querySelector('button')
        if (!slowBtn || !(slowBtn.textContent || '').toLowerCase().includes('slow download') || attachedSlowDl.has(slowBtn)) return
        attachedSlowDl.add(slowBtn)

        const isNMM = isNMMDownload(slowBtn, location.search)
        slowBtn.addEventListener('click', async e => {
            e.preventDefault()
            e.stopImmediatePropagation()
            await startDownloadFlow({ btn: slowBtn, fileId: fid, isNMM, href: location.href })
        })

        if (cfg.AutoStartDownload && !autoFiredIds.has(fid)) {
            autoFiredIds.add(fid)
            startDownloadFlow({ btn: slowBtn, fileId: fid, isNMM, href: location.href, isAutoStart: true }).then(() => cfg.AutoCloseTab && setTimeout(() => window.close(), cfg.CloseTabDelay))
        }
    }

    function upsellBlocker() {
        if (!cfg.HidePremiumUpsells) return
        if (!stylesInjected) {
            GM_addStyle(['#nonPremiumBanner', '#freeTrialBanner', '#ig-banner-container', '#rj-vortex', '[class*="ads-bottom"]', '[class*="ads-top"]', '[class*="to-premium"]', '[class*="from-premium"]', '[class*="premium"]', '#mainContent > div.ads-holder', '#head > div.rj-right-tray.rj-profile-tray.rj-open > ul > li.user-profile-menu-section-top > a'].map(s => `${s}{display:none!important}`).join('\n'))
            stylesInjected = true
        }
        document.querySelector('.bg-nexus-premium-gradient')?.remove()
    }

    function archivedFileHandler() {
        if (!cfg.HandleArchivedFiles || !isModPage()) return
        const url = location.href
        if (url.includes('tab=files') && !url.includes('category=archived')) {
            const footer = document.querySelector('#files-tab-footer')
            if (footer && !handledArchive.has(footer)) {
                handledArchive.add(footer)
                footer.querySelector('p')?.style.setProperty('display', 'none')
                if (!Array.from(footer.querySelectorAll('a.btn.inline-flex .flex-label')).some(el => el.textContent.trim() === 'File archive')) {
                    footer.insertAdjacentHTML('beforeend', `<a class="btn inline-flex" data-archived-btn="true" href="${escapeAttr(url)}&category=archived" style="background:#da8e35;color:#fff;margin-left:8px;"><span class="flex-label">File archive</span></a>`)
                }
            }
        }
        if (!url.includes('category=archived')) return
        document.querySelectorAll('.file-expander-header').forEach((h, i) => {
            const box = document.querySelectorAll('.accordion-downloads')[i],
                fileId = h?.dataset?.id
            if (!fileId || !box || handledArchive.has(box) || box.querySelector('p') || h.querySelector('.icon-tickunsafe')) return
            handledArchive.add(box)
            const safeBase = escapeAttr(`${location.origin}${location.pathname}`)
            box.innerHTML = `<a class="btn inline-flex" href="${safeBase}?tab=files&file_id=${fileId}&nmm=1"><span class="flex-label">Mod manager download</span></a> <a class="btn inline-flex" href="${safeBase}?tab=files&file_id=${fileId}"><span class="flex-label">Manual download</span></a>`
        })
    }

    function forceModManagerHandler() {
        if (!cfg.ForceModManagerDownload || !isModPage()) return
        document.querySelectorAll('a[href*="file_id="]:not([href*="nmm=1"]), a.btn[href*="tab=files"]:not([href*="nmm=1"])').forEach(link => {
            if (handledForceNmm.has(link) || !(link.textContent || link.getAttribute('aria-label') || '').toLowerCase().includes('manual')) return
            let sArea = link.parentElement,
                hasMan = false
            for (let i = 0; i < 3 && sArea; i++, sArea = sArea.parentElement) {
                if (Array.from(sArea.querySelectorAll('a, button')).some(el => el !== link && (el.href?.includes('nmm=1') || /manager|vortex/i.test(el.textContent || el.getAttribute('aria-label') || '')))) {
                    hasMan = true
                    break
                }
            }
            handledForceNmm.add(link)
            if (hasMan) return
            const isLi = link.parentElement?.tagName === 'LI',
                node = isLi ? link.parentElement : link
            const clone = node.cloneNode(true),
                ml = isLi ? clone.querySelector('a') : clone
            if (ml.href?.includes('file_id=')) ml.href = appendNmmParam(ml.href)
            const lbl = ml.querySelector('.flex-label') || ml
            lbl.textContent = (link.textContent || '').toLowerCase().includes('download') ? '(NNW++) Mod manager download' : '(NNW++) Mod manager'
            node.parentNode.insertBefore(clone, node)
        })
    }

    // Settings UI
    function SettingsUI() {
        const SETTING_UI = [
            { key: 'AutoStartDownload', label: 'Auto Start Download on file_id= URLs', type: 'bool', description: 'Automatically start downloads when visiting file download pages (URLs containing file_id=)' },
            { key: 'AutoCloseTab', label: 'Auto-Close Tab After AutoStartDownload', type: 'bool', description: 'Auto-close may be unreliable due to browser permissions.', showIf: () => cfg.AutoStartDownload },
            { key: 'SkipRequirements', label: 'Skip Requirements PopUp/Tab', type: 'bool', description: 'Skip the requirements popup/page and proceed directly to download' },
            { key: 'ShowAlertsOnError', label: 'Show Alert Messages on Errors', type: 'bool', description: 'Display error messages as browser popup alerts' },
            { key: 'PlayErrorSound', label: 'Play Error Sound', type: 'bool', description: 'Play an error sound when download errors occur' },
            { key: 'HidePremiumUpsells', label: 'Hide Premium Upsells & misc Annoyances (experimental)', type: 'bool', description: 'Hide premium upgrade banners, trial offers, and other annoyances on the site (experimental). You are probably better off using an adblocker.' },
            { key: 'OverrideFileNames', label: 'Append Mod ID to Filenames (Manual Downloads)', type: 'bool', description: 'Restores the Mod ID to downloaded files. Note: Your browser may prompt you for download permissions the first time, and it may take longer to initate downloads.' },
            { key: 'ForceModManagerDownload', label: 'Generate mod manager download buttons for manual-only downloads', type: 'bool', description: "Inject mod-manager download buttons on files that don't have any." },
            { key: 'HandleArchivedFiles', label: 'Generate download buttons for Archived Files', type: 'bool', description: 'Enable handling of archived files.' },
            { key: 'RequestTimeout', label: 'Request Timeout', type: 'number', description: 'Maximum time to wait for server responses before timing out (in milliseconds)' },
            { key: 'CloseTabDelay', label: 'Auto-Close Tab Delay', type: 'number', description: 'Delay before automatically closing the tab after download starts (in milliseconds)', showIf: () => cfg.AutoStartDownload && cfg.AutoCloseTab },
            { key: 'ErrorSoundUrl', label: 'Error Sound URL', type: 'text', description: 'URL of the custom sound file to play for error alerts', showIf: () => cfg.PlayErrorSound }
        ]

        const STYLES = {
            modal: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#2f2f2f;color:#dadada;padding:25px;border-radius:4px;z-index:2147483647;min-width:300px;max-width:90%;max-height:90vh;overflow-y:auto;font-family:'Inter','Helvetica Neue', Helvetica, Arial, sans-serif;",
            backdrop: 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:2147483646;',
            section: 'background:#363636;padding:15px;border-radius:4px;margin-bottom:15px;',
            sectionHeader: 'color:#da8e35;margin:0 0 10px 0;font-size:16px;font-weight:500;',
            input: 'background:#2f2f2f;border:1px solid #444;color:#dadada;border-radius:3px;padding:5px;',
            row: 'margin-bottom:10px;',
            label: 'display:flex;align-items:center;gap:8px;',
            btnObj: { primary: 'padding:8px 15px;border:none;background:#da8e35;color:white;border-radius:3px;cursor:pointer;', secondary: 'padding:8px 15px;border:1px solid #da8e35;background:transparent;color:#da8e35;border-radius:3px;cursor:pointer;', closeX: 'position:absolute;top:10px;right:10px;background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;padding:5px;' }
        }

        function save() {
            try {
                GM_setValue(CONFIG_KEY, JSON.stringify(cfg))
                logEvent('debug', 'config:saved')
            } catch (e) {
                Logger.error('Failed to save config:', e)
            }
        }

        let activeModal = null,
            activeBackdrop = null
        const closeModal = () => {
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
                const display = !setting.showIf || setting.showIf() ? 'block' : 'none'
                const desc = escapeAttr(setting.description || '')
                if (setting.type === 'bool') {
                    return `<div style="${STYLES.row}display:${display}"><label title="${desc}" style="${STYLES.label}cursor:pointer;"><input type="checkbox" data-setting="${setting.key}" ${cfg[setting.key] ? 'checked' : ''}><span>${setting.label}</span></label></div>`
                } else if (setting.type === 'number') {
                    const step = setting.key === 'CloseTabDelay' ? 100 : 1
                    return `<div style="${STYLES.row}display:${display}"><label title="${desc}" style="${STYLES.label}"><span>${setting.label}:</span><input type="number" value="${escapeAttr(cfg[setting.key])}" min="0" step="${step}" data-setting="${setting.key}" style="${STYLES.input}width:120px;"></label></div>`
                } else if (setting.type === 'text') {
                    return `<div style="${STYLES.row}display:${display}"><label title="${desc}" style="${STYLES.label}flex-direction:column;align-items:stretch;gap:4px;"><span style="font-size:0.9em;color:#aaa;">${setting.label}:</span><input type="text" value="${escapeAttr(cfg[setting.key])}" data-setting="${setting.key}" style="${STYLES.input}width:95%;"></label></div>`
                }
                return ''
            }

            modal.innerHTML = `<style>a:hover { text-decoration: underline !important; }</style>
        <button id="closeSettingsX" style="${STYLES.btnObj.closeX}">×</button>
        <h3 style="${STYLES.sectionHeader}margin-top:0;">NexusNoWait++ Settings</h3>
        <div style="${STYLES.section}"><h4 style="${STYLES.sectionHeader}">Features</h4>${SETTING_UI.filter(u => u.type !== 'number')
            .map(build)
            .join('')}</div>
        <div style="${STYLES.section}"><h4 style="${STYLES.sectionHeader}">Timing</h4>${SETTING_UI.filter(u => u.type === 'number')
            .map(build)
            .join('')}</div>
        <div style="display:flex;justify-content:center;gap:10px;margin-top:20px;"><button id="resetSettings" style="${STYLES.btnObj.secondary}">Reset Settings</button><button id="closeSettings" style="${STYLES.btnObj.primary}">Save & Close</button></div>
        <div style="text-align:center;margin-top:10px;color:#888;font-size:11px;">Some changed settings may require a page reload to take effect.</div>
        <div style="text-align:center;margin-top:12px;color:#666;font-size:12px;">v${GM_info.script.version} by Torkelicious</div>
        <div style="text-align:center;margin-top:6px;color:#666;font-size:10px;"><a href="https://github.com/torkelicious/nexus-no-wait-pp/" target="_blank" style="color:#666;">This software is open-source and licensed under the GPLv3</a></div>`

            const updateVisibility = () => {
                for (const setting of SETTING_UI) {
                    if (!setting.showIf) continue
                    const row = modal.querySelector(`[data-setting="${setting.key}"]`)?.closest('div')
                    if (row) row.style.display = setting.showIf() ? 'block' : 'none'
                }
            }

            const update = element => {
                const key = element.getAttribute('data-setting')
                if (!key) return
                let value = element.type === 'checkbox' ? element.checked : element.type === 'number' ? parseInt(element.value, 10) : element.value
                if (typeof value === 'number' && isNaN(value)) return (element.value = cfg[key])
                if (cfg[key] !== value) {
                    cfg[key] = value
                    save()
                }
                updateVisibility()
            }

            modal.addEventListener('change', e => {
                if (e.target?.hasAttribute('data-setting')) update(e.target)
            })
            modal.addEventListener('input', e => {
                if (['number', 'text'].includes(e.target.type) && e.target?.hasAttribute('data-setting')) update(e.target)
            })
            modal.querySelector('#closeSettingsX').addEventListener('click', closeModal)
            modal.querySelector('#closeSettings').addEventListener('click', closeModal)
            modal.querySelector('#resetSettings').addEventListener('click', () => {
                cleanResetConfig()
                closeModal()
            })
            document.body.appendChild(modal)
            activeModal = modal
            updateVisibility()
            document.addEventListener('keydown', onSettingsKeyDown)
        }
        if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('Settings', showSettingsModal)
    }

    // initialization
    function handleDomUpdates() {
        upsellBlocker()
        archivedFileHandler()
        forceModManagerHandler()
        setupSlowDownloadIntercept()
    }

    function main() {
        if (!listenersAttached) {
            setupAudio()
            SettingsUI()
            attachClickInterceptor()
            interceptRequirementsTab()
            domObserver = new MutationObserver(() => {
                if (domUpdateTimeout) clearTimeout(domUpdateTimeout)
                domUpdateTimeout = setTimeout(handleDomUpdates, 150)
            })
            domObserver.observe(document.body, { childList: true, subtree: true })
            listenersAttached = true
        }
        autoStartDownload()
        handleDomUpdates()
        logEvent('info', 'init', { url: location.href })
    }

    let lastUrl = location.href
    const originalPushState = history.pushState,
        originalReplaceState = history.replaceState
    const onNavigate = () => {
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

    main()
})()
