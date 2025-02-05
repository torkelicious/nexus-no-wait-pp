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

/* jshint esversion: 6 */

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
        } catch (e) {
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

        console.error("[Nexus No Wait ++]: " + message);
        if (showAlert && config.showAlerts) {
            playErrorSound();  // Play sound before alert
            alert("[Nexus No Wait ++] \n" + message);
        }

        if (config.refreshOnError) {
            location.reload();
        }
    }

    // Sound utility with custom sound and fallback
    function playErrorSound() {
        if (!config.playErrorSound) return;
        
        const customSound = new Audio('https://github.com/torkelicious/nexus-no-wait-pp/raw/refs/heads/dev/errorsound.mp3');
        customSound.onerror = () => {
            // Fallback to beep if custom sound fails
            const beep = new Audio('data:audio/wav;base64,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qJrx4KOQjahZxWbcZgztj2c49nKmkId44S71j0c8eV9yDK6uPRzx5X18eDvjvQ6yKo9ZSS6l//8elePK/Lf//IInrOF/FvDoADYAGBMGb7FtErm5MXMlmPAJQVgWta7Zx2go+8xJ0UiCb8LHHdftWyLJE0QIAIsI+UbXu67dZMjmgDGCGl1H+vpF4NSDckSIkk7Vd+sxEhBQMRU8j/12UIRhzSaUdQ+rQU5kGeFxm+hb1oh6pWWmv3uvmReDl0UnvtapVaIzo1jZbf/pD6ElLqSX+rUmOQNpJFa/r+sa4e/pBlAABoAAAAA3CUgShLdGIxsY7AUABPRrgCABdDuQ5GC7DqPQCgbbJUAoRSUj+NIEig0YfyWUho1VBBBA//uQZB4ABZx5zfMakeAAAAmwAAAAF5F3P0w9GtAAACfAAAAAwLhMDmAYWMgVEG1U0FIGCBgXBXAtfMH10000EEEEEECUBYln03TTTdNBDZopopYvrTTdNa325mImNg3TTPV9q3pmY0xoO6bv3r00y+IDGid/9aaaZTGMuj9mpu9Mpio1dXrr5HERTZSmqU36A3CumzN/9Robv/Xx4v9ijkSRSNLQhAWumap82WRSBUqXStV/YcS+XVLnSS+WLDroqArFkMEsAS+eWmrUzrO0oEmE40RlMZ5+ODIkAyKAGUwZ3mVKmcamcJnMW26MRPgUw6j+LkhyHGVGYjSUUKNpuJUQoOIAyDvEyG8S5yfK6dhZc0Tx1KI/gviKL6qvvFs1+bWtaz58uUNnryq6kt5RzOCkPWlVqVX2a/EEBUdU1KrXLf40GoiiFXK///qpoiDXrOgqDR38JB0bw7SoL+ZB9o1RCkQjQ2CBYZKd/+VJxZRRZlqSkKiws0WFxUyCwsKiMy7hUVFhIaCrNQsKkTIsLivwKKigsj8XYlwt/WKi2N4d//uQRCSAAjURNIHpMZBGYiaQPSYyAAABLAAAAAAAACWAAAAApUF/Mg+0aohSIRobBAsMlO//Kk4soosy1JSFRYWaLC4qZBYWFRGZdwqKiwkNBVmoWFSJkWFxX4FFRQWR+LsS4W/rFRb/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////VEFHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAU291bmRib3kuZGUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMjAwNGh0dHA6Ly93d3cuc291bmRib3kuZGUAAAAAAAAAACU=');
            beep.play().catch(e => console.warn("Error playing fallback sound:", e));
        };
        
        // Try to play custom sound
        customSound.play().catch(e => {
            console.warn("Error playing custom sound:", e);
            customSound.onerror(); // Trigger fallback
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

        if (!obj.url || !obj.type) {
            logMessage("Missing required parameters for AJAX request", true);
            return;
        }

        const requestObj = {
            url: obj.url,
            method: obj.type,
            data: obj.data,
            headers: obj.headers,
            timeout: config.requestTimeout,
            ontimeout: () => {
                logMessage("Request timed out", true);
            },
            onload: (result) => {
                if (!result) {
                    return obj.error("No response received");
                }

                if (result.status !== 200) {
                    let errorMsg = result.responseText || `HTTP Error ${result.status}`;
                    return obj.error({
                        status: result.status,
                        message: errorMsg,
                        responseText: result.responseText
                    });
                }

                return obj.success(result.responseText);
            },
            onerror: (result) => {
                let errorMsg = result.responseText || `HTTP Error ${result.status}`;
                return obj.error({
                    status: result.status,
                    message: errorMsg,
                    responseText: result.responseText
                });
            }
        };

        ajaxRequestRaw(requestObj);
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
                observer.disconnect();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
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
            name: "Debug Alerts",
            description: "Show all console logs as alerts, don't enable unless you know what you are doing!"
        },
        playErrorSound: {
            name: 'Play Error Sound',
            description: 'Play a sound when errors occur'
        },
    };

    function createSettingsUI() {
        const btn = document.createElement('div');
        btn.innerHTML = 'NexusNoWait++ ⚙️';
        btn.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #414141;
            color: white;
            padding: 10px 15px;
            border-radius: 6px;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            z-index: 9999;
            font-family: -apple-system, system-ui, sans-serif;
            font-size: 14px;
            transition: all 0.2s ease;
        `;
        
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

    function generateSettingsHTML() {
        const normalBooleanSettings = Object.entries(config)
            .filter(([key, value]) => typeof value === 'boolean' && key !== 'debug')
            .map(([key, value]) => `
                <div>
                    <label title="${SETTING_UI[key].description}">
                        <input type="checkbox" 
                               ${value ? 'checked' : ''} 
                               data-setting="${key}">
                        ${SETTING_UI[key].name}
                    </label>
                </div>`).join('');

        const numberSettings = Object.entries(config)
            .filter(([_, value]) => typeof value === 'number')
            .map(([key, value]) => `
                <div>
                    <label title="${SETTING_UI[key].description}">
                        ${SETTING_UI[key].name} (ms):
                        <input type="number" 
                               value="${value}"
                               min="0"
                               step="100"
                               data-setting="${key}"
                               style="width: 100px; margin-left: 5px;">
                    </label>
                </div>`).join('');

        // Separate debug setting with improved styling
        const debugSetting = `
            <div style="margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
                <details style="
                    background: #f9f9f9;
                    padding: 8px 12px;
                    border-radius: 4px;
                    border: 1px solid #e0e0e0;
                ">
                    <summary style="
                        color: #666;
                        cursor: pointer;
                        font-size: 11px;
                        user-select: none;
                        font-family: monospace;
                    ">⚠️ Developer Options</summary>
                    <div style="
                        margin-top: 8px;
                        padding: 8px;
                        background: white;
                        border-radius: 3px;
                    ">
                        <label title="${SETTING_UI['debug'].description}" style="
                            font-size: 11px;
                            color: #666;
                            display: flex;
                            align-items: center;
                            gap: 6px;
                        ">
                            <input type="checkbox" 
                                   ${config.debug ? 'checked' : ''} 
                                   data-setting="debug">
                            ${SETTING_UI['debug'].name}
                        </label>
                    </div>
                </details>
            </div>`;

        return `
            <h3 style="margin: 0 0 20px 0; color: #da8e35; font-size: 18px;">NexusNoWait++ Settings</h3>
            <div style="margin-bottom: 20px;">
                <h4 style="color: #414141; margin: 0 0 10px 0;">Features</h4>
                ${normalBooleanSettings}
            </div>
            <div style="margin-bottom: 20px;">
                <h4 style="color: #414141; margin: 0 0 10px 0;">Timeouts</h4>
                ${numberSettings}
            </div>
            ${debugSetting}
            <div style="margin-top: 20px; display: flex; justify-content: space-between;">
                <button id="resetSettings" style="padding: 8px 15px; border: 1px solid #ff4444; background: white; color: #ff4444; border-radius: 4px; cursor: pointer;">Reset to Default</button>
                <button id="closeSettings" style="padding: 8px 15px; border: none; background: #da8e35; color: white; border-radius: 4px; cursor: pointer;">Save & Close</button>
            </div>
        `; 
    }

    let activeModal = null;
    let settingsChanged = false;  // Track if settings were changed

    function showSettingsModal() {
        if (activeModal) {
            activeModal.remove();
        }

        settingsChanged = false;  // Reset change tracker
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 25px;
            border-radius: 8px;
            box-shadow: 0 2px 20px rgba(0,0,0,0.15);
            z-index: 10000;
            min-width: 300px;
            max-width: 90%;
            max-height: 90vh;
            overflow-y: auto;
            font-family: -apple-system, system-ui, sans-serif;
        `;

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
            const oldDebug = config.debug;  // Store old debug state
            Object.assign(config, { [name]: value });
            saveSettings(config);
            
            // Reset console if debug mode was changed
            if (oldDebug !== config.debug) {
                location.reload();  // Reload to reset console state
            } else {
                applySettings();
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

    // button observer 
    const buttonObserver = new MutationObserver((mutations) => {
        try {
            mutations.forEach(mutation => {
                if (!mutation.addedNodes) return;
                
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    
                    if (node.matches("a.btn")) {
                        addClickListener(node);
                    } else {
                        addClickListeners(node.querySelectorAll("a.btn"));
                    }
                });
            });
        } catch (error) {
            console.error("Error in button observer:", error);
        }
    });

    // Initialize everything
    initializeUI();
    initMainFunctions();
    buttonObserver.observe(document, {childList: true, subtree: true});

    // Observer to handle download buttons
    let observer = new MutationObserver(((mutations, observer) => {
        for (let i = 0; i < mutations.length; i++) {
            if (mutations[i].addedNodes) {
                for (let x = 0; x < mutations[i].addedNodes.length; x++) {
                    const node = mutations[i].addedNodes[x];

                    if (node.tagName === "A" && node.classList.contains("btn")) {
                        addClickListener(node);
                    } else if (node.children && node.children.length > 0) {
                        addClickListeners(node.querySelectorAll("a.btn"));
                    }
                }
            }
        }
    }));
    observer.observe(document, {childList: true, subtree: true});
})();