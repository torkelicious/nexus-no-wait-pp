// ==UserScript==
// @name        Nexus No Wait ++
// @description Skip Countdown, Auto Download, and More for Nexus Mods. Supports (Manual/Vortex/MO2/NMM)
// @version     devel
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
    const DEFAULTS = {
        AutoStartDownload: true,
        AutoCloseTab: true,
        SkipRequirements: true,
        ShowAlertsOnError: true,
        PlayErrorSound: true,
        ErrorSoundUrl: 'https://github.com/torkelicious/nexus-no-wait-pp/raw/refs/heads/main/errorsound.mp3',
        HandleArchivedFiles: true,
        HidePremiumUpsells: false,
        OverrideFileNames: false,
        ForceModManagerDownload: false,
        CloseTabDelay: 2000,
        RequestTimeout: 30000
    }

    function loadConfig() {
        try {
            const raw = typeof GM_getValue === 'function' ? GM_getValue(CONFIG_KEY, null) : null
            const parsed = raw ? { ...DEFAULTS, ...(typeof raw === 'string' ? JSON.parse(raw) : raw) } : { ...DEFAULTS }
            logEvent('debug', 'config:load', { activeConfig: parsed })
            return parsed
        } catch (e) {
            Logger.warn('Failed to load config, using defaults', e)
            return { ...DEFAULTS }
        }
    }

    // logging
    const Logger = (() => {
        const tag = () => `[NexusNoWait++ v${GM_info.script.version}]`
        return ['debug', 'info', 'warn', 'error'].reduce((o, lvl) => {
            o[lvl] = (...a) => console[lvl](tag(), ...a)
            return o
        }, {})
    })()
    const logEvent = (level, event, data = {}) => Logger[level](event, data)

    let cfg = loadConfig()

    // prevent duplicate actions
    const processing = new WeakSet() // click interceptor
    const handledArchive = new WeakSet() // archived file handler
    const handledForceNmm = new WeakSet() // force mod manager handler
    const attachedSlowDl = new WeakSet() // slow download button listener
    // tracking for auto firing
    const autoFiredIds = new Set()
    let listenersAttached = false
    let errorAudioPlayer = null
    let stylesInjected = false

    // network utils
    const gmXmlHttpRequest = typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest.bind(GM) : typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null
    if (!gmXmlHttpRequest) Logger.error('No GM XHR API available. Script may not function correctly.')

    function gmRequest(url, opts = {}) {
        return new Promise(resolve => {
            if (!gmXmlHttpRequest) return resolve({ text: '', finalUrl: '', headers: '' })
            gmXmlHttpRequest({
                method: opts.method || 'GET',
                ...opts,
                url,
                timeout: opts.timeout ?? cfg.RequestTimeout,
                headers: opts.headers || {},
                data: opts.data || null,
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

    // DOM & parsing utils
    const MOD_PAGE_PATTERN = /\/mods\/\d+/
    const isModPage = () => MOD_PAGE_PATTERN.test(location.pathname)
    function isNMMDownload(element, href = '') {
        if (href && (href.startsWith('nxm://') || href.includes('nmm=1') || href.includes('&nmm=1'))) return true
        if (!element) return false
        if (element.id === 'action-vortex' || element.id === 'action-nmm') return true
        const text = (element.textContent || (typeof element.getAttribute === 'function' && element.getAttribute('aria-label')) || '').toLowerCase()
        return /(vortex|mod manager|manager download)/i.test(text)
    }

    const getGameId = (clickedElement = null) => {
        if (clickedElement) {
            let current = clickedElement
            while (current) {
                if (['MOD-DOWNLOAD-BUTTONS', 'MOD-FILE-DOWNLOAD'].includes(current.tagName) && current.getAttribute('game-id')) {
                    return current.getAttribute('game-id')
                }
                current = current.parentNode || (current instanceof ShadowRoot ? current.host : null)
            }
        }
        const el = document.querySelector('[data-game-id], [game-id]')
        if (el) return el.dataset.gameId || el.getAttribute('game-id')
        for (const script of document.querySelectorAll('script')) {
            const m = script.textContent.match(/game_id\s*:\s*(\d+)/) || script.textContent.match(/gameId\s*:\s*(\d+)/)
            if (m) return m[1]
        }
        return document.getElementById('section')?.dataset?.gameId || location.pathname.split('/')[1] || ''
    }

    function parseDownloadURLFromResponse(text) {
        if (!text) return null
        try {
            const json = JSON.parse(String(text))
            if (json?.url) return { url: json.url.replace(/&amp;/g, '&') }
        } catch (e) {}
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

    function getFilenameFromHead(headerStr) {
        if (!headerStr) return null
        if (typeof headerStr === 'object') headerStr = headerStr['content-disposition'] || headerStr['Content-Disposition'] || ''
        const match = String(headerStr).match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i)
        return match && match[1] ? match[1].replace(/['"]/g, '').trim() : null
    }

    // requirements detection
    function readRequirementsFlag(el) {
        if (!el || typeof el.getAttribute !== 'function') return null
        let sawAnyAttribute = false
        let hasEntries = false
        let hadParseError = false
        const reqRaw = el.getAttribute('requirements')
        if (reqRaw !== null && reqRaw !== undefined) {
            sawAnyAttribute = true
            try {
                const parsed = JSON.parse(reqRaw)
                if (Array.isArray(parsed) && parsed.length > 0) hasEntries = true
            } catch (e) {
                hadParseError = true
            }
        }
        const depRaw = el.getAttribute('dependencies')
        if (depRaw !== null && depRaw !== undefined) {
            sawAnyAttribute = true
            try {
                const parsed = JSON.parse(depRaw)
                if (Array.isArray(parsed)) {
                    const hasFiles = parsed.some(group => Array.isArray(group?.files) && group.files.length > 0)
                    if (hasFiles) hasEntries = true
                }
            } catch (e) {
                hadParseError = true
            }
        }
        if (!sawAnyAttribute) return null
        if (hasEntries) return true
        if (hadParseError) return null
        return false
    }

    function detectRequirements(elements) {
        let sawDefinitiveFalse = false
        let sawAnyCandidate = false
        for (const el of elements) {
            if (!el) continue
            sawAnyCandidate = true
            const flag = readRequirementsFlag(el)
            if (flag === true) return { hasRequirements: true, unknown: false }
            if (flag === false) sawDefinitiveFalse = true
        }
        if (sawDefinitiveFalse) return { hasRequirements: false, unknown: false }
        return { hasRequirements: false, unknown: sawAnyCandidate }
    }

    // download resolution
    async function getDownloadUrl({ fileId, gameId, isNMM, href }) {
        if (!fileId && !href) return { url: null, error: 'Missing fileId' }
        if (href && href.startsWith('nxm://')) return { url: href }
        let link = null
        if (href && href.includes('/api/files/')) {
            logEvent('info', 'download:resolve-api', { href })
            let targetApiUrl = href
            if (isNMM && !targetApiUrl.includes('nmm=1')) targetApiUrl += (targetApiUrl.includes('?') ? '&' : '?') + 'nmm=1'
            try {
                const res = await gmRequest(targetApiUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
                link = res.finalUrl && res.finalUrl !== targetApiUrl ? res.finalUrl : null
                const locationMatch = res.headers.match(/Location:\s*(nxm:\/\/[^\s]+)/i)
                if (locationMatch) link = locationMatch[1]
                const extractedJson = parseDownloadURLFromResponse(res.text)
                if (extractedJson) link = extractedJson.url
                const extractedNxm = parseDownloadLink(res.text) || parseDownloadLink(res.finalUrl)
                if (extractedNxm) link = extractedNxm
                if (link) return { url: link }
            } catch (err) {
                Logger.warn('API fetch failed:', err)
            }
        }
        if (isNMM && href) {
            let nmmHref = href
            if (!nmmHref.includes('nmm=1')) nmmHref += (nmmHref.includes('?') ? '&' : '?') + 'nmm=1'
            const res = await gmRequest(nmmHref, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            })
            link = parseDownloadLink(res.finalUrl) || (res.headers.match(/Location:\s*(nxm:\/\/[^\s]+)/i) || [])[1] || parseDownloadLink(res.text)
            if (!link && /ModRequirementsPopUp/i.test(nmmHref)) {
                const reqMatch = res.text.match(/href=["']([^"']*?file_id[^"']*?)["']/i)
                if (reqMatch) {
                    const res2 = await gmRequest(reqMatch[1])
                    link = parseDownloadLink(res2.finalUrl) || (res2.headers.match(/Location:\s*(nxm:\/\/[^\s]+)/i) || [])[1] || parseDownloadLink(res2.text)
                }
            }
            if (link) return { url: link }
        }
        if (fileId) {
            const endpoint = '/Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl'
            const spoofedReferer = `https://www.nexusmods.com${location.pathname}?tab=files&file_id=${fileId}`
            let postData = `fid=${encodeURIComponent(fileId)}&game_id=${encodeURIComponent(gameId || '')}`
            if (isNMM) postData += '&nmm=1'

            const res = await gmRequest(endpoint, {
                method: 'POST',
                data: postData,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    Origin: 'https://www.nexusmods.com',
                    Referer: href || spoofedReferer
                }
            })
            const extracted = parseDownloadURLFromResponse(res.text)
            if (extracted) link = extracted.url
        }
        if (link) return { url: link }
        return {
            url: null,
            error: 'Could not resolve file link (are you logged in?)'
        }
    }

    async function normalizeDownloadUrl(url, isNMM) {
        if (!url || url.startsWith('nxm://')) return url
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
            } catch (e) {}
        }
        return url
    }

    async function scrapeDeepDownloadLink(pageUrl, isNMM) {
        try {
            const res = await gmRequest(pageUrl)
            const html = res.text
            const fileDataRegex = /(?:main-file|file)=(["'])(.*?)\1/gi
            let match
            while ((match = fileDataRegex.exec(html)) !== null) {
                try {
                    const unescaped = match[2]
                        .replace(/&quot;/g, '"')
                        .replace(/&amp;/g, '&')
                        .replace(/&#34;/g, '"')
                    if (!unescaped.includes('downloadUrl')) continue
                    const fileData = JSON.parse(unescaped)
                    const secureApiUrl = isNMM ? fileData.vortexDownloadUrl || fileData.downloadUrl : fileData.downloadUrl
                    if (secureApiUrl) return secureApiUrl
                } catch (e) {}
            }
            const cdnMatch = html.match(/https?:\/\/[a-zA-Z0-9-]+\.nexus-cdn\.com[^"']+/i)
            if (cdnMatch) return cdnMatch[0].replace(/&amp;/g, '&')
            return null
        } catch (e) {
            return null
        }
    }

    // button state & execution
    function setButtonState(button, state, message) {
        if (!button) return
        const textElement = button.querySelector('span.flex-label, span') || button
        const stateConfig = {
            waiting: { text: 'Please Wait...', color: 'orange' },
            downloading: { text: 'Downloading!', color: 'green' },
            error: { text: message || 'Error', color: 'red' }
        }
        const config = stateConfig[state] || stateConfig.error
        if (textElement) textElement.innerText = config.text
        button.style.color = config.color
    }

    function handleError(btn, error) {
        if (btn) setButtonState(btn, 'error', error)
        Logger.error('Download Error:', error)
        if (cfg.PlayErrorSound) playErrorSound()
        if (cfg.ShowAlertsOnError) alert(`Download error: ${error}`)
    }

    async function startDownloadFlow({ btn, fileId, isNMM, href, isAutoStart = false }) {
        if (btn) setButtonState(btn, 'waiting')
        logEvent('debug', isAutoStart ? 'download:auto-start' : 'download:start', { fileId, isNMM, href })
        const gameId = getGameId(btn)
        const { url, error } = await getDownloadUrl({ fileId, gameId, isNMM, href })
        if (error) return handleError(btn || null, error)
        let finalUrl = url
        if (btn) setButtonState(btn, 'downloading')
        finalUrl = await normalizeDownloadUrl(finalUrl, isNMM)
        if (!finalUrl) return handleError(btn || null, 'Failed to resolve download URL')
        logEvent('info', 'download:resolved', { url: finalUrl })

        // safety:  if API returns a Requirements URL and user wants to see requirements then stop
        if (/ModRequirementsPopUp|tab=requirements/i.test(finalUrl) && !cfg.SkipRequirements) {
            logEvent('info', 'Halting flow: File has requirements & SkipRequirements is false', { finalUrl })
            location.assign(finalUrl)
            return
        }

        // prevent redirects
        if (cfg.SkipRequirements && !finalUrl.startsWith('nxm://') && finalUrl.includes('nexusmods.com') && (finalUrl.includes('file_id=') || /\/files\/\d+/i.test(finalUrl)) && !finalUrl.includes('GenerateDownloadUrl') && !finalUrl.includes('nexus-cdn.com')) {
            const deepLink = await scrapeDeepDownloadLink(finalUrl, isNMM)
            if (deepLink) {
                if (deepLink.includes('/api/files/') || deepLink.includes('GenerateDownloadUrl')) {
                    const resolved = await getDownloadUrl({ href: deepLink, gameId, isNMM })
                    if (resolved?.url) finalUrl = resolved.url
                } else {
                    finalUrl = deepLink
                }
            }
        }
        if (cfg.OverrideFileNames && typeof GM_download === 'function' && !isNMM && !finalUrl.startsWith('nxm://')) {
            const modIdMatch = location.pathname.match(/\/mods\/(\d+)/)
            const modId = modIdMatch ? modIdMatch[1] : null
            if (modId) {
                let originalName = decodeURIComponent(finalUrl.split('/').pop().split('?')[0]) || 'nexus_download'
                let extIndex = originalName.lastIndexOf('.')
                const looksLikeUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(originalName)
                if (looksLikeUUID || extIndex === -1) {
                    logEvent('info', 'download: URL hides filename, fetching headers')
                    try {
                        const headRes = await gmRequest(finalUrl, { method: 'HEAD' })
                        const realName = getFilenameFromHead(headRes.headers)
                        if (realName) {
                            originalName = realName
                            extIndex = originalName.lastIndexOf('.')
                        } else {
                            logEvent('warn', 'download: Could not get real filename from server, fallback', { url: finalUrl })
                            location.assign(finalUrl)
                            return
                        }
                    } catch (err) {
                        logEvent('error', 'download: Header fetch failed, fallback', err)
                        location.assign(finalUrl)
                        return
                    }
                }
                let newName = extIndex !== -1 ? `${originalName.substring(0, extIndex)}-${modId}${originalName.substring(extIndex)}` : `${originalName}-${modId}`
                const idRegex = new RegExp(`(^|[^0-9])${modId}([^0-9]|$)`)
                if (extIndex === -1) {
                    logEvent('info', 'download: filename has no extension, appending ID to end')
                }
                if (idRegex.test(originalName)) {
                    newName = originalName
                } else {
                    logEvent('info', 'download: overriding file-name', { originalName, newName })
                }
                GM_download({
                    url: finalUrl,
                    name: newName,
                    saveAs: false,
                    onload: () => logEvent('debug', 'download: override name success'),
                    onerror: err => {
                        logEvent('warn', 'download: override name failed, fallback', err)
                        location.assign(finalUrl)
                    }
                })
                return
            }
        }
        location.assign(finalUrl)
    }

    // click interception
    const IGNORE_ANCESTORS = '.pagination, .comment-container, .comment-content, .forum-post, .search-results, #nnwpp-btn'
    const DOWNLOAD_HREF_PATTERNS = ['/Core/Libs/Common/', 'tab=files&file_id=', 'file_id=', 'ModRequirementsPopUp', '/api/files/', 'nxm://']
    const isDownloadHref = href => DOWNLOAD_HREF_PATTERNS.some(p => href.toLowerCase().includes(p.toLowerCase()))

    function extractFileId(href) {
        try {
            if (href.startsWith('nxm://')) {
                const urlParams = new URLSearchParams(href.substring(href.indexOf('?')))
                return urlParams.get('id') || urlParams.get('file_id')
            }
            const url = new URL(href, location.href)
            const apiMatch = url.pathname.match(/\/api\/files\/(\d+)/)
            if (apiMatch) return apiMatch[1]
            return url.searchParams.get('file_id') || url.searchParams.get('id')
        } catch (e) {
            return null
        }
    }

    function findDownloadModalInPath(path) {
        let modal = path.find(n => n && n.tagName === 'MOD-DOWNLOAD-MODAL')
        if (!modal) {
            for (const node of path) {
                if (node && node.shadowRoot) {
                    modal = node.shadowRoot.querySelector('mod-download-modal')
                    if (modal) break
                }
            }
        }
        return modal || path.find(n => n && ['MOD-DOWNLOAD-BUTTONS', 'MOD-FILE-DOWNLOAD'].includes(n.tagName))?.querySelector('mod-download-modal')
    }

    function attachClickInterceptor() {
        document.body.addEventListener(
            'click',
            async function (event) {
                if (!isModPage() || !event.isTrusted || event.defaultPrevented) return

                const path = event.composedPath ? event.composedPath() : [event.target]
                const element = path.find(n => n && (n.tagName === 'A' || n.tagName === 'BUTTON')) || event.target.closest('a,button')
                if (!element || element.closest(IGNORE_ANCESTORS)) return
                let href = element.getAttribute('href') || element.href || ''
                if (href.includes('tab=files') && !href.includes('file_id=')) return
                const isNMM = isNMMDownload(element, href)
                let fileId = extractFileId(href)
                let secureApiUrl = null

                const modal = findDownloadModalInPath(path)
                if (modal) {
                    try {
                        const fileData = JSON.parse(modal.getAttribute('file') || '{}')
                        if (fileData.downloadUrl) secureApiUrl = isNMM ? fileData.vortexDownloadUrl || fileData.downloadUrl : fileData.downloadUrl
                    } catch (e) {}
                }

                const hostContainer = path.find(n => n && ['MOD-DOWNLOAD-BUTTONS', 'MOD-FILE-DOWNLOAD'].includes(n.tagName))
                if (!secureApiUrl && hostContainer) {
                    try {
                        const attrName = hostContainer.tagName === 'MOD-DOWNLOAD-BUTTONS' ? 'main-file' : 'file'
                        const fileData = JSON.parse(hostContainer.getAttribute(attrName) || '{}')
                        if (fileData.id && !fileId) fileId = fileData.id.toString()
                    } catch (e) {}
                }

                const { hasRequirements: hasRequirementsAlert, unknown: requirementsUnknown } = detectRequirements([modal, hostContainer])
                const hasRequirementsHref = href.includes('ModRequirementsPopUp') || href.includes('tab=requirements')
                const isDownloadLink = fileId || secureApiUrl || isDownloadHref(href) || (modal && (isNMM || (element.textContent || '').toLowerCase().includes('manual')))
                if (!isDownloadLink) return
                if ((hasRequirementsAlert || hasRequirementsHref) && !cfg.SkipRequirements) {
                    secureApiUrl = null
                    logEvent('info', 'Yielding to native UI: File has requirements & SkipRequirements is false')
                    return
                }
                if (requirementsUnknown && !cfg.SkipRequirements) {
                    logEvent('warn', 'Yielding to native UI: could not confirm requirements state & SkipRequirements is false')
                    return
                }
                if (processing.has(element)) return
                if ((element.textContent || '').toLowerCase().includes('slow download')) return
                processing.add(element)
                event.preventDefault()
                event.stopImmediatePropagation()
                try {
                    const finalHref = secureApiUrl || href || `https://www.nexusmods.com${location.pathname}?tab=files&file_id=${fileId}`
                    if ((hasRequirementsAlert || hasRequirementsHref) && cfg.SkipRequirements) {
                        logEvent('info', 'requirements:skipped', { isNMM, url: finalHref })
                    }
                    await startDownloadFlow({
                        btn: element,
                        fileId: secureApiUrl ? null : fileId,
                        isNMM,
                        href: finalHref
                    })
                } catch (e) {
                    handleError(element, String(e))
                } finally {
                    processing.delete(element)
                }
            },
            true
        )
    }

    function interceptRequirementsTab() {
        document.body.addEventListener(
            'click',
            function (event) {
                if (!event.isTrusted || event.defaultPrevented || !cfg.SkipRequirements) return
                const linkElement = event.composedPath ? event.composedPath().find(n => n && n.tagName === 'A') : event.target.closest('a')
                if (!linkElement) return
                const href = linkElement.getAttribute('href') || linkElement.href || ''
                if (!href.includes('tab=requirements')) return
                event.preventDefault()
                event.stopImmediatePropagation()
                logEvent('debug', 'navigation:requirements-tab-intercepted')
                location.replace(href.replace('tab=requirements', 'tab=files'))
            },
            true
        )
    }

    // features
    async function autoStartDownload() {
        if (!cfg.AutoStartDownload || !isModPage()) return
        if (location.search.includes('tab=files') && !location.pathname.includes('/files/')) return
        if (document.querySelector('mod-file-download')) return
        const fileId = new URLSearchParams(location.search).get('file_id')
        if (!fileId || autoFiredIds.has(fileId)) return
        autoFiredIds.add(fileId)
        const isNMM = isNMMDownload(null, location.search)
        await new Promise(r => setTimeout(r, 200))
        await startDownloadFlow({
            fileId,
            isNMM,
            href: location.href,
            isAutoStart: true
        })
        if (cfg.AutoCloseTab) {
            logEvent('debug', 'tab:closing', { delay: cfg.CloseTabDelay })
            setTimeout(() => window.close(), cfg.CloseTabDelay)
        }
    }

    function setupSlowDownloadIntercept() {
        if (!location.search.includes('file_id')) return
        const slowBtn = document.querySelector('mod-file-download')?.shadowRoot?.querySelector('button')
        if (!slowBtn || !(slowBtn.textContent || '').toLowerCase().includes('slow download') || attachedSlowDl.has(slowBtn)) return
        attachedSlowDl.add(slowBtn)
        slowBtn.addEventListener('click', async event => {
            event.preventDefault()
            event.stopImmediatePropagation()
            const fid = new URLSearchParams(location.search).get('file_id')
            if (fid) {
                logEvent('debug', 'download:slow-intercept', { fileId: fid, isNMM: isNMMDownload(slowBtn, location.search) })
                await startDownloadFlow({
                    btn: slowBtn,
                    fileId: fid,
                    isNMM: isNMMDownload(slowBtn, location.search),
                    href: location.href
                })
            }
        })

        if (cfg.AutoStartDownload) {
            const fid = new URLSearchParams(location.search).get('file_id')
            if (fid && !autoFiredIds.has(fid)) {
                autoFiredIds.add(fid)
                startDownloadFlow({
                    btn: slowBtn,
                    fileId: fid,
                    isNMM: isNMMDownload(slowBtn, location.search),
                    href: location.href,
                    isAutoStart: true
                }).then(() => {
                    if (cfg.AutoCloseTab) {
                        logEvent('debug', 'tab:closing', { delay: cfg.CloseTabDelay })
                        setTimeout(() => window.close(), cfg.CloseTabDelay)
                    }
                })
            }
        }
    }

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

    function upsellBlocker() {
        if (!cfg.HidePremiumUpsells) return
        if (!stylesInjected) {
            logEvent('debug', 'ui:upsell-blocker-active')
            const selectors = ['#nonPremiumBanner', '#freeTrialBanner', '#ig-banner-container', '#rj-vortex', '[class*="ads-bottom"]', '[class*="ads-top"]', '[class*="to-premium"]', '[class*="from-premium"]', '[class*="premium"]', '#mainContent > div.ads-holder', '#head > div.rj-right-tray.rj-profile-tray.rj-open > ul > li.user-profile-menu-section-top > a']
            GM_addStyle(selectors.map(s => `${s}{display:none!important}`).join('\n'))
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
                const hasArchiveBtn = Array.from(footer.querySelectorAll('a.btn.inline-flex .flex-label')).some(el => el.textContent.trim() === 'File archive')
                if (!hasArchiveBtn) {
                    logEvent('debug', 'ui:archive-button-restored')
                    footer.insertAdjacentHTML('beforeend', `<a class="btn inline-flex" data-archived-btn="true" href="${url}&category=archived" style="background:#da8e35;color:#fff;margin-left:8px;"><span class="flex-label">File archive</span></a>`)
                }
            }
        }
        if (!url.includes('category=archived')) return
        const headers = document.getElementsByClassName('file-expander-header')
        const downloads = document.getElementsByClassName('accordion-downloads')
        for (let i = 0; i < headers.length; i++) {
            const fileId = headers[i]?.dataset?.id
            const box = downloads[i]
            if (!fileId || !box || handledArchive.has(box)) continue
            handledArchive.add(box)
            const safeId = encodeURIComponent(fileId)
            box.innerHTML = `<a class="btn inline-flex" href="${location.origin}${location.pathname}?tab=files&file_id=${safeId}&nmm=1"><span class="flex-label">Mod manager download</span></a> <a class="btn inline-flex" href="${location.origin}${location.pathname}?tab=files&file_id=${safeId}"><span class="flex-label">Manual download</span></a>`
        }
    }

    function forceModManagerHandler() {
        if (!cfg.ForceModManagerDownload || !isModPage()) return
        const manualLinks = document.querySelectorAll('a[href*="file_id="]:not([href*="nmm=1"]), a.btn[href*="tab=files"]:not([href*="nmm=1"])')
        for (const link of manualLinks) {
            if (handledForceNmm.has(link)) continue
            const text = (link.textContent || link.getAttribute('aria-label') || '').toLowerCase()
            if (!text.includes('manual')) continue
            let hasManagerLink = false
            let searchArea = link.parentElement
            for (let i = 0; i < 3; i++) {
                if (!searchArea) break
                for (const el of searchArea.querySelectorAll('a, button')) {
                    if (el === link || handledForceNmm.has(el)) continue
                    const t = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase()
                    if ((el.href && el.href.includes('nmm=1')) || t.includes('manager') || t.includes('vortex')) {
                        hasManagerLink = true
                        break
                    }
                }
                if (hasManagerLink) break
                searchArea = searchArea.parentElement
            }
            handledForceNmm.add(link)
            if (hasManagerLink) continue
            const isLi = link.parentElement && link.parentElement.tagName === 'LI'
            const nodeToClone = isLi ? link.parentElement : link
            const clone = nodeToClone.cloneNode(true)
            const managerLink = isLi ? clone.querySelector('a') : clone
            if (managerLink.href && managerLink.href.includes('file_id=')) {
                try {
                    const nmmUrl = new URL(managerLink.href, location.origin)
                    nmmUrl.searchParams.set('nmm', '1')
                    managerLink.href = nmmUrl.toString()
                } catch (e) {
                    managerLink.href += (managerLink.href.includes('?') ? '&' : '?') + 'nmm=1'
                }
            }
            const label = managerLink.querySelector('.flex-label') || managerLink
            label.textContent = text.includes('download') ? '(NNW++) Mod manager download' : '(NNW++) Mod manager'
            nodeToClone.parentNode.insertBefore(clone, nodeToClone)
        }
    }

    // Settings UI
    function SettingsUI() {
        const SETTING_UI = [
            { key: 'AutoStartDownload', label: 'Auto Start Download on file_id= URLs', type: 'bool' },
            { key: 'AutoCloseTab', label: 'Auto-Close Tab After AutoStartDownload', type: 'bool', showIf: () => cfg.AutoStartDownload },
            { key: 'SkipRequirements', label: 'Skip Requirements PopUp/Tab', type: 'bool' },
            { key: 'ShowAlertsOnError', label: 'Show Alert Messages on Errors', type: 'bool' },
            { key: 'PlayErrorSound', label: 'Play Error Sound', type: 'bool' },
            { key: 'HidePremiumUpsells', label: 'Hide Premium Upsells (experimental)', type: 'bool' },
            { key: 'OverrideFileNames', label: 'Append Mod ID to Filenames (Manual)', type: 'bool' },
            { key: 'ForceModManagerDownload', label: 'Generate mod manager buttons for manual files', type: 'bool' },
            { key: 'HandleArchivedFiles', label: 'Generate download buttons for Archived Files', type: 'bool' },
            { key: 'RequestTimeout', label: 'Request Timeout (ms)', type: 'number' },
            { key: 'CloseTabDelay', label: 'Auto-Close Tab Delay', type: 'number', showIf: () => cfg.AutoStartDownload && cfg.AutoCloseTab },
            { key: 'ErrorSoundUrl', label: 'Error Sound URL', type: 'text', showIf: () => cfg.PlayErrorSound }
        ]

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
            backdrop.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:2147483646;'
            backdrop.onclick = closeModal
            document.body.appendChild(backdrop)
            activeBackdrop = backdrop

            const modal = document.createElement('div')
            modal.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#2f2f2f;color:#dadada;padding:25px;border-radius:4px;z-index:2147483647;min-width:300px;max-width:90%;max-height:90vh;overflow-y:auto;font-family:'Inter', sans-serif;"

            const build = setting => {
                const display = !setting.showIf || setting.showIf() ? 'block' : 'none'
                if (setting.type === 'bool') {
                    return `<div style="margin-bottom:10px;display:${display}"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" data-setting="${setting.key}" ${cfg[setting.key] ? 'checked' : ''}><span>${setting.label}</span></label></div>`
                }
                if (setting.type === 'number') {
                    return `<div style="margin-bottom:10px;display:${display}"><label style="display:flex;align-items:center;gap:8px;"><span>${setting.label}:</span><input type="number" value="${cfg[setting.key]}" data-setting="${setting.key}" style="background:#2f2f2f;border:1px solid #444;color:#dadada;padding:5px;width:80px;"></label></div>`
                }
                if (setting.type === 'text') {
                    return `<div style="margin-bottom:10px;display:${display}"><label style="display:flex;flex-direction:column;gap:4px;"><span style="color:#aaa;">${setting.label}:</span><input type="text" value="${cfg[setting.key]}" data-setting="${setting.key}" style="background:#2f2f2f;border:1px solid #444;color:#dadada;padding:5px;width:100%;"></label></div>`
                }
                return ''
            }

            modal.innerHTML = `
        <button id="closeSettingsX" style="position:absolute;top:10px;right:10px;background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">×</button>
        <h3 style="color:#da8e35;margin-top:0;">NexusNoWait++ Settings</h3>
        <div style="background:#363636;padding:15px;border-radius:4px;margin-bottom:15px;">${SETTING_UI.filter(u => u.type !== 'number')
            .map(build)
            .join('')}</div>
        <div style="background:#363636;padding:15px;border-radius:4px;">${SETTING_UI.filter(u => u.type === 'number')
            .map(build)
            .join('')}</div>
        <div style="display:flex;justify-content:center;gap:10px;margin-top:20px;"><button id="resetSettings" style="padding:8px 15px;border:1px solid #da8e35;background:transparent;color:#da8e35;cursor:pointer;">Reset Defaults</button><button id="closeSettings" style="padding:8px 15px;border:none;background:#da8e35;color:white;cursor:pointer;">Save & Close</button></div>
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
                let value = element.type === 'checkbox' ? element.checked : element.type === 'number' ? parseInt(element.value, 10) : element.value
                if (typeof value === 'number' && isNaN(value)) {
                    element.value = cfg[key]
                    return
                }
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
                logEvent('info', 'config:reset-requested')
                cfg = { ...DEFAULTS }
                save()
                location.reload()
            })
            document.body.appendChild(modal)
            activeModal = modal
            updateVisibility()
            document.addEventListener('keydown', onSettingsKeyDown)
        }
        if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('Settings', showSettingsModal)
    }

    // initialization
    let domObserver = null
    let domUpdateTimeout = null

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
            // persistent MutationObserver for SPA DOM injections
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
    const originalPushState = history.pushState
    const originalReplaceState = history.replaceState
    function onNavigate() {
        if (location.href === lastUrl) return
        lastUrl = location.href
        main()
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
