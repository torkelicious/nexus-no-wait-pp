// ==UserScript==
// @name        Nexus No Wait ++ (DEV)
// @description Download from Nexusmods.com without wait and redirect (Manual/Vortex/MO2/NMM), Tweaked with extra features.
// @namespace   NexusNoWaitPlusPlus
// @version     dev-2.1
// @include     https://www.nexusmods.com/*/mods/*
// @run-at      document-idle
// @iconURL     https://raw.githubusercontent.com/torkelicious/nexus-no-wait-pp/refs/heads/main/icon.png
// @grant       GM_xmlhttpRequest
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_deleteValue
// @license MIT
// ==/UserScript==

/* global GM_getValue, GM_setValue, GM_deleteValue, GM_xmlhttpRequest, GM */

(function () {

    // === Configuration ===
    const DEFAULT_CONFIG = {
        autoCloseTab: true,        // Close tab after download starts
        skipRequirements: true,    // Skip requirements popup/tab
        showAlerts: true,          // Show errors as browser alerts
        refreshOnError: false,     // Refresh page on error
        requestTimeout: 30000,     // Request timeout (30 sec)
        closeTabTime: 1000,        // Wait before closing tab (1 sec)
        debug: false,              // Show debug messages as alerts
        playErrorSound: true,      // Play a sound on error
    };

    // Load settings from GM storage
    function loadSettings() {
        try {
            const saved = GM_getValue('nexusNoWaitConfig', null);
            return saved ? JSON.parse(saved) : DEFAULT_CONFIG;
        } catch {
            console.warn('GM storage load failed, using defaults');
            return DEFAULT_CONFIG;
        }
    }

    // Save settings to GM storage
    function saveSettings(settings) {
        try {
            GM_setValue('nexusNoWaitConfig', JSON.stringify(settings));
            logMessage('Settings saved to GM storage', false, true);
        } catch (e) {
            console.error('Failed to save settings:', e);
        }
    }
    const config = Object.assign({}, DEFAULT_CONFIG, loadSettings());

    // Create single global sound instance
    const errorSound = new Audio('https://github.com/torkelicious/nexus-no-wait-pp/raw/refs/heads/dev/errorsound.mp3');
    errorSound.load(); // Preload sound

    // === Error Handling ===

    /**
     * Centralized logging function
     * @param {string} message - Message to display/log
     * @param {boolean} [showAlert=false] - If true, shows browser alert
     * @param {boolean} [isDebug=false] - If true, handles debug logs
     * @returns {void}
     */
    function logMessage(message, showAlert = false, isDebug = false) {
        if (isDebug) {
            console.log("[Nexus No Wait ++]: " + message);
            if (config.debug) {
                playErrorSound();  // Play sound before alert
                alert("[Nexus No Wait ++] Debug:\n" + message);
            }
            return;
        }

        playErrorSound();  // Play sound before alert
        console.error("[Nexus No Wait ++]: " + message);
        if (showAlert && config.showAlerts) {
            alert("[Nexus No Wait ++] \n" + message);
        }

        if (config.refreshOnError) {
            location.reload();
        }
    }

    // Simplified sound utility
    function playErrorSound() {
        if (!config.playErrorSound) return;
        errorSound.play().catch(e => {
            console.warn("Error playing sound:", e);
        });
    }

    // === URL and Navigation Handling ===
    /**
     * Auto-redirects from requirements to files
     */
    if (window.location.href.includes('tab=requirements') && config.skipRequirements) 
    {
        const newUrl = window.location.href.replace('tab=requirements', 'tab=files');
        window.location.replace(newUrl);
        return;
    }

    // === AJAX Setup and Configuration ===
    let ajaxRequestRaw;
    if (typeof(GM_xmlhttpRequest) !== "undefined") 
    {
        ajaxRequestRaw = GM_xmlhttpRequest;
    } else if (typeof(GM) !== "undefined" && typeof(GM.xmlHttpRequest) !== "undefined") {
        ajaxRequestRaw = GM.xmlHttpRequest;
    }

    // Wrapper for AJAX requests
    function ajaxRequest(obj) {
        if (!ajaxRequestRaw) {
            logMessage("AJAX functionality not available", true);
            return;
        }
        ajaxRequestRaw({
            method: obj.type,
            url: obj.url,
            data: obj.data,
            headers: obj.headers,
            onload: function(response) {
                if (response.status >= 200 && response.status < 300) {
                    obj.success(response.responseText);
                } else {
                    obj.error(response);
                }
            },
            onerror: function(response) {
                obj.error(response);
            },
            ontimeout: function(response) {
                obj.error(response);
            }
        });
    }

    // === Button State Management ===

    /**
     * Updates button appearance and shows error message
     * @param {HTMLElement} button - The button element
     * @param {Error|Object} error - Error details
     */
    function btnError(button, error) {
        button.style.color = "red";
        let errorMessage = "Download failed: " + (error?.message || "Unknown error");
        button.innerText = "ERROR: " + errorMessage;
        logMessage(errorMessage, true);
    }

    function btnSuccess(button) {
        button.style.color = "green";
        button.innerText = "Downloading!";
        logMessage("Download started.", false, true);
    }

    function btnWait(button) {
        button.style.color = "yellow";
        button.innerText = "Wait...";
        logMessage("Loading...", false, true);
    }


    // Closes the tab after download starts
    function closeOnDL() 
    {
        if (config.autoCloseTab)
        {
        setTimeout(() => window.close(), config.closeTabTime);
        }
    }

    // === Download Handling ===
    /**
     * Main click event handler for download buttons
     * Handles both manual and mod manager downloads
     * @param {Event} event - Click event object
     */
    function clickListener(event) {
        const href = this.href || window.location.href;
        const params = new URL(href).searchParams;

        if (params.get("file_id")) {
            let button = event;
            if (this.href) {
                button = this;
                event.preventDefault();
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
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
                },
                success(data) {
                    if (data) {
                        try {
                            data = JSON.parse(data);
                            if (data.url) {
                                btnSuccess(button);
                                document.location.href = data.url;
                                closeOnDL(); 
                            }
                        } catch (e) {
                            btnError(button, e); 
                        }
                    }
                },
                error(xhr) {  
                    btnError(button, xhr);
                }
            };

            if (!params.get("nmm")) {
                ajaxRequest(ajaxOptions);
            } else {
                ajaxRequest({
                    type: "GET",
                    url: href,
                    headers: {
                        Origin: "https://www.nexusmods.com",
                        Referer: document.location.href,
                        "Sec-Fetch-Site": "same-origin",
                        "X-Requested-With": "XMLHttpRequest"
                    },
                    success(data) {
                        if (data) {
                            const xml = new DOMParser().parseFromString(data, "text/html");
                            const slow = xml.getElementById("slowDownloadButton");
                            if (slow && slow.getAttribute("data-download-url")) {
                                const downloadUrl = slow.getAttribute("data-download-url");
                                btnSuccess(button);
                                document.location.href = downloadUrl;
                                closeOnDL();  
                            } else {
                                btnError(button);
                            }
                        }
                    },
                    error(xhr) {
                        btnError(button, xhr);  
                    }
                });
            }

            const popup = this.parentNode;
            if (popup && popup.classList.contains("popup")) {
                popup.getElementsByTagName("button")[0].click();
                const popupButton = document.getElementById("popup" + fileId);
                if (popupButton) {
                    btnSuccess(popupButton);
                    closeOnDL();
                }
            }
        } else if (/ModRequirementsPopUp/.test(href)) {
            const fileId = params.get("id");

            if (fileId) {
                this.setAttribute("id", "popup" + fileId);
            }
        }
    }

    // === Event Listeners  ===
    /**
     * Attaches click event listener with proper context
     * @param {HTMLElement} el - the element to attach listener to
     */
    function addClickListener(el) {
        el.addEventListener("click", clickListener, true);
    }

    // Attaches click event listeners to multiple elements
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

    // Automatically skips file requirements popup and starts download
    function autoClickRequiredFileDownload() {
        const observer = new MutationObserver(() => {
            const downloadButton = document.querySelector(".popup-mod-requirements a.btn");
            if (downloadButton) {
                downloadButton.click();
                const popup = document.querySelector(".popup-mod-requirements");
                if (!popup) {
                    // Popup is gone, ready for next appearance
                    logMessage("Popup closed", false, true);
                }
            }
        });

        observer.observe(document.body, { 
            childList: true, 
            subtree: true,
            attributes: true, // Also watch for attribute changes
            attributeFilter: ['style', 'class'] // Specifically watch style and class changes
        });
    }

    // === Archived Files Handling ===

    // Modifies download links for archived files
    // Adds both manual and mod manager download options to archived files
    function archivedFile() {
        if (/[?&]category=archived/.test(window.location.href)) {
            const fileIds = document.getElementsByClassName("file-expander-header");
            const elements = document.getElementsByClassName("accordion-downloads");
            const path = `${location.protocol}//${location.host}${location.pathname}`;
            
            for (let i = 0; i < elements.length; i++) {
                elements[i].innerHTML = ''
                    + `<li><a class="btn inline-flex" href="${path}?tab=files&amp;file_id=${fileIds[i].getAttribute("data-id")}&amp;nmm=1" tabindex="0">`
                    + "<svg title=\"\" class=\"icon icon-nmm\"><use xlink:href=\"https://www.nexusmods.com/assets/images/icons/icons.svg#icon-nmm\"></use></svg> <span class=\"flex-label\">Mod manager download</span>"
                    + "</a></li>"
                    + `<li><a class="btn inline-flex" href="${path}?tab=files&amp;file_id=${fileIds[i].getAttribute("data-id")}" tabindex="0">`
                    + "<svg title=\"\" class=\"icon icon-manual\"><use xlink:href=\"https://www.nexusmods.com/assets/images/icons/icons.svg#icon-manual\"></use></svg> <span class=\"flex-label\">Manual download</span>"
                    + "</a></li>";
            }
        }
    }


// --------------------------------------------- === UI === --------------------------------------------- //

    const SETTING_UI = {
        autoCloseTab: {
            name: 'Auto-Close tab on download',
            description: 'Automatically close tab after download starts'
        },
        skipRequirements: {
            name: 'Skip Requirements Popup/Tab',
            description: 'Skip requirements page and go straight to download'
        },
        showAlerts: {
            name: 'Show Error Alert messages',
            description: 'Show error messages as browser alerts'
        },
        refreshOnError: {
            name: 'Refresh page on error',
            description: 'Refresh the page when errors occur (may lead to infinite refresh loop!)'
        },
        requestTimeout: {
            name: 'Request Timeout',
            description: 'Time to wait for server response before timeout'
        },
        closeTabTime: {
            name: 'Auto-Close tab Delay',
            description: 'Delay before closing tab after download starts (Setting this too low may prevent download from starting!)'
        },
        debug: {
            name: "⚠️ Debug Alerts",
            description: "Show all console logs as alerts, don't enable unless you know what you are doing!"
        },
        playErrorSound: {
            name: 'Play Error Sound',
            description: 'Play a sound when errors occur'
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
            font-family:-apple-system, system-ui, sans-serif;`,
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
                }`
        }
    };

    function createSettingsUI() {
        const btn = document.createElement('div');
        btn.innerHTML = 'NexusNoWait++ ⚙️';
        btn.style.cssText = STYLES.button;
        
        btn.onmouseover = () => btn.style.transform = 'translateY(-2px)';
        btn.onmouseout = () => btn.style.transform = 'translateY(0)';
        btn.onclick = () => {
            if (activeModal) {
                activeModal.remove();
                activeModal = null;
                if (settingsChanged) {  // Only reload if settings were changed
                    location.reload();
                }
            } else {
                showSettingsModal();
            }
        };
        document.body.appendChild(btn);
    }

    // Simplified settings UI 
    function generateSettingsHTML() {
        const normalBooleanSettings = Object.entries(SETTING_UI)
            .filter(([key]) => typeof config[key] === 'boolean' && !['debug'].includes(key))
            .map(([key, {name, description}]) => `
                <div style="margin-bottom:10px;">
                    <label title="${description}" style="display:flex;align-items:center;gap:8px;">
                        <input type="checkbox" 
                               ${config[key] ? 'checked' : ''} 
                               data-setting="${key}">
                        <span>${name}</span>
                    </label>
                </div>`).join('');

        const numberSettings = Object.entries(SETTING_UI)
            .filter(([key]) => typeof config[key] === 'number')
            .map(([key, {name, description}]) => `
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
                </div>`).join('');

        // Hidden debug section
        const advancedSection = `
            <div id="advancedSection" style="display:none;">
                <div style="${STYLES.section}">
                    <h4 style="${STYLES.sectionHeader}">Advanced Settings</h4>
                    <div style="margin-bottom:10px;">
                        <label title="${SETTING_UI.debug.description}" style="display:flex;align-items:center;gap:8px;">
                            <input type="checkbox" 
                                   ${config.debug ? 'checked' : ''} 
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
            </div>`;
    }

    let activeModal = null;
    let settingsChanged = false;  // Track if settings were changed

    function showSettingsModal() {
        if (activeModal) {
            activeModal.remove();
        }

        settingsChanged = false;  // Reset change tracker
        const modal = document.createElement('div');
        modal.style.cssText = STYLES.modal;

        modal.innerHTML = generateSettingsHTML();

        // Simple update function
        function updateSetting(element) {
            const setting = element.getAttribute('data-setting');
            const value = element.type === 'checkbox' ? 
                element.checked : 
                parseInt(element.value, 10);

            if (typeof value === 'number' && isNaN(value)) {
                element.value = config[setting];
                return;
            }

            if (config[setting] !== value) {
                settingsChanged = true;
                window.nexusConfig.setFeature(setting, value);
            }
        }

        modal.addEventListener('change', (e) => {
            if (e.target.hasAttribute('data-setting')) {
                updateSetting(e.target);
            }
        });

        modal.addEventListener('input', (e) => {
            if (e.target.type === 'number' && e.target.hasAttribute('data-setting')) {
                updateSetting(e.target);
            }
        });

        modal.querySelector('#closeSettings').onclick = () => {
            modal.remove();
            activeModal = null;
            // Only reload if settings were changed
            if (settingsChanged) {
                location.reload();
            }
        };

        modal.querySelector('#resetSettings').onclick = () => {
            settingsChanged = true;  // Reset counts as a change
            window.nexusConfig.reset();
            saveSettings(config);
            modal.remove();
            activeModal = null;
            location.reload(); // Add reload here instead of showing modal again
        };

        // Add toggle handler for advanced section
        modal.querySelector('#toggleAdvanced').onclick = (e) => {
            const section = modal.querySelector('#advancedSection');
            const isHidden = section.style.display === 'none';
            section.style.display = isHidden ? 'block' : 'none';
            e.target.textContent = `Advanced ${isHidden ? '▲' : '▼'}`;
        };

        document.body.appendChild(modal);
        activeModal = modal;
    }

    // Override console methods when debug is enabled
    function setupDebugMode() {
        if (config.debug) {
            const originalConsole = {
                log: console.log,
                warn: console.warn,
                error: console.error
            };

            console.log = function() {
                originalConsole.log.apply(console, arguments);
                alert("[Debug Log]\n" + Array.from(arguments).join(' '));
            };

            console.warn = function() {
                originalConsole.warn.apply(console, arguments);
                alert("[Debug Warn]\n" + Array.from(arguments).join(' '));
            };

            console.error = function() {
                originalConsole.error.apply(console, arguments);
                alert("[Debug Error]\n" + Array.from(arguments).join(' '));
            };
        }
    }

    window.nexusConfig = {
        setFeature: (name, value) => {
            const oldValue = config[name];
            Object.assign(config, { [name]: value });
            saveSettings(config);
            
            // Only apply non-debug settings immediately
            if (name !== 'debug') {
                applySettings();
            }
            
            // Mark settings as changed if value actually changed
            if (oldValue !== value) {
                settingsChanged = true;
            }
        },
        reset: () => {
            GM_deleteValue('nexusNoWaitConfig');
            Object.assign(config, DEFAULT_CONFIG);
            saveSettings(config);
            applySettings();  // Apply changes immediately
        },
        getConfig: () => config
    };

    function applySettings() {
        // Update AJAX timeout
        if (ajaxRequestRaw) {
            ajaxRequestRaw.timeout = config.requestTimeout;
        }
        setupDebugMode();  // Setup debug console overrides
    }
    // UI Initialization
    applySettings();
    createSettingsUI();

// ------------------------------------------------------------------------------------------------ //

    // ===  Initialization ===
    function initializeUI() {
        applySettings();
        createSettingsUI();
    }

    function initMainFunctions() {
        archivedFile();
        addClickListeners(document.querySelectorAll("a.btn"));
        autoStartFileLink();
        if (config.skipRequirements) {
            autoClickRequiredFileDownload();
        }
    }

    // Combined observer
    const mainObserver = new MutationObserver((mutations) => {
        try {
            mutations.forEach(mutation => {
                if (!mutation.addedNodes) return;
                
                mutation.addedNodes.forEach(node => {
                    // Handle direct button matches
                    if (node.tagName === "A" && node.classList?.contains("btn")) {
                        addClickListener(node);
                    }
                    
                    // Handle nested buttons
                    if (node.querySelectorAll) {
                        addClickListeners(node.querySelectorAll("a.btn"));
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
    
    // Start observing with combined configuration
    mainObserver.observe(document, {
        childList: true, 
        subtree: true
    });

    // Cleanup on page unload
    window.addEventListener('unload', () => {
        mainObserver.disconnect();
    });
})();