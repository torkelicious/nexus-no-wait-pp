// ==UserScript==
// @name        Nexus No Wait ++
// @description Download from Nexusmods.com without wait and redirect (Manual/Vortex/MO2/NMM), Tweaked with extra features.
// @namespace   NexusNoWaitPlusPlus
// @include     https://www.nexusmods.com/*/mods/*
// @run-at      document-idle
// @iconURL     https://github.com/torkelicious/nexus-no-wait-pp/blob/main/icon.png
// @grant       GM_xmlhttpRequest
// @version     1.0.5
// @license MIT
// @downloadURL https://update.greasyfork.org/scripts/519037/Nexus%20No%20Wait%20%2B%2B.user.js
// @updateURL https://update.greasyfork.org/scripts/519037/Nexus%20No%20Wait%20%2B%2B.meta.js
// ==/UserScript==

/* jshint esversion: 6 */

(function () {
    if (window.location.href.includes('tab=requirements')) {
        const newUrl = window.location.href.replace('tab=requirements', 'tab=files');
        window.location.replace(newUrl);
        return;
    }

    let ajaxRequestRaw;

    if (typeof(GM_xmlhttpRequest) !== "undefined") {
        ajaxRequestRaw = GM_xmlhttpRequest;
    } else if (typeof(GM) !== "undefined" && typeof(GM.xmlHttpRequest) !== "undefined") {
        ajaxRequestRaw = GM.xmlHttpRequest;
    }

    function ajaxRequest(obj) {
        if (!ajaxRequestRaw) {
            console.log("Unable to request", obj);

            return;
        }

        const requestObj = {
            url: obj.url,
            method: obj.type,
            data: obj.data,
            headers: obj.headers
        };

        let loadCb = function (result) {
            if (result.readyState !== 4) {
                return;
            }

            if (result.status !== 200) {
                return obj.error(result);
            }

            return obj.success(result.responseText);
        };

        requestObj.onload = loadCb;
        requestObj.onerror = loadCb;

        ajaxRequestRaw(requestObj);
    }

    function btnError(button) {
        button.style.color = "red";
        button.innerText = "ERROR";
        alert("Nexus Error, download failed!. Manually download or try again.\n More information may exist in chrome developer console \n(Ctrl + Shift + J) ");

    }

    function btnSuccess(button) {
        button.style.color = "green";
        button.innerText = "Downloading!";
        console.log("Download started.");

    }

    function btnWait(button) {
        button.style.color = "yellow";
        button.innerText = "Wait...";
        console.log("Loading...");
    }

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

            if (!params.get("nmm")) {
                ajaxRequest({
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

                                    setTimeout(function() {
                                        window.close();
                                    }, 2500);

                                }
                            } catch (e) {
                                console.error(e);
                            }
                        }
                    },
                    error() {
                        btnError(button);
                    }
                });
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
                            const downloadUrl = slow.getAttribute("data-download-url");
                            btnSuccess(button);
                            document.location.href = downloadUrl;

                            setTimeout(function() {
                                window.close();
                            }, 2500);

                        }
                    },
                    error(ajaxContext) {
                        console.error(ajaxContext.responseText);
                        btnError(button);
                    }
                });
            }

            const popup = this.parentNode;
            if (popup && popup.classList.contains("popup")) {
                popup.getElementsByTagName("button")[0].click();
                const popupButton = document.getElementById("popup" + fileId);
                if (popupButton) {
                    btnSuccess(popupButton);
                }
            }
        } else if (/ModRequirementsPopUp/.test(href)) {
            const fileId = params.get("id");

            if (fileId) {
                this.setAttribute("id", "popup" + fileId);
            }
        }
    }

    function addClickListener(el) {
        el.addEventListener("click", clickListener, true);
    }

    function addClickListeners(els) {
        for (let i = 0; i < els.length; i++) {
            addClickListener(els[i]);
        }
    }

    function autoStartFileLink() {
        if (/file_id=/.test(window.location.href)) {
            clickListener(document.getElementById("slowDownloadButton"));
        }
    }

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


    function archivedFile() {
        if (/[?&]category=archived/.test(window.location.href)) {
            const fileIds = document.getElementsByClassName("file-expander-header");
            const elements = document.getElementsByClassName("accordion-downloads");
            const path = `${location.protocol}//${location.host}${location.pathname}`;
            for (let i = 0; i < elements.length; i++) {
                elements[i].innerHTML = ''
                    + `<li><a class="btn inline-flex" href="${path}?tab=files&amp;file_id=${fileIds[i].getAttribute("data-id")}&amp;nmm=1" tabindex="0">`
					+ "<svg title=\"\" class=\"icon icon-nmm\"><use xlink:href=\"https://www.nexusmods.com/assets/images/icons/icons.svg#icon-nmm\"></use></svg> <span class=\"flex-label\">Mod manager download</span>"
                    + "</a></li><li></li><li>"
                    + `<li><a class="btn inline-flex" href="${path}?tab=files&amp;file_id=${fileIds[i].getAttribute("data-id")}" tabindex="0">`
					+ "<svg title=\"\" class=\"icon icon-manual\"><use xlink:href=\"https://www.nexusmods.com/assets/images/icons/icons.svg#icon-manual\"></use></svg> <span class=\"flex-label\">Manual download</span>"
                    + "</a></li>";
            }
        }
    }

    archivedFile();
    addClickListeners(document.querySelectorAll("a.btn"));
    autoStartFileLink();
    autoClickRequiredFileDownload();


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