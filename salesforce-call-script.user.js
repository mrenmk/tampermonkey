// ==UserScript==
// @name         Salesforce Call Script
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Automate call registration in Salesforce
// @author       mrenmk
// @match        https://dsp-portal.lightning.force.com/lightning/r/Account/*
// @updateURL    https://raw.githubusercontent.com/mrenmk/tampermonkey/main/salesforce-call-script.user.js
// @downloadURL  https://raw.githubusercontent.com/mrenmk/tampermonkey/main/salesforce-call-script.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        DELAYS: {
            TYPING: 10,
            ACTION: 500
        }
    };

    // Debug Panel (commented out for production)
    /*
    const debugPanel = document.createElement('div');
    debugPanel.style.cssText = `
        position: fixed;
        bottom: 10px;
        left: 10px;
        width: 300px;
        height: 200px;
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 10px;
        border-radius: 5px;
        font-family: monospace;
        font-size: 12px;
        overflow-y: auto;
        z-index: 10000;
    `;
    document.body.appendChild(debugPanel);
    */

    function debug(message) {
        console.log(message);
        /*
        const messageElement = document.createElement('div');
        messageElement.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
        debugPanel.appendChild(messageElement);
        debugPanel.scrollTop = debugPanel.scrollHeight;
        */
    }

    // Helper Functions
    const helpers = {
        sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

        simulateTyping: async (element, text) => {
            element.focus();
            element.value = '';
            for (let char of text) {
                element.value += char;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                await helpers.sleep(CONFIG.DELAYS.TYPING);
            }
            element.dispatchEvent(new Event('change', { bubbles: true }));
        },

        click: async (element) => {
            element.focus();

            // Try direct click first
            if (element.click && typeof element.click === 'function') {
                element.click();
            } else {
                // Fallback to mouse events only if direct click doesn't exist
                element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            }

            await helpers.sleep(CONFIG.DELAYS.ACTION);
        },

        getCurrentDate: () => {
            const date = new Date();
            return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
        },

        waitForElement: (selector, timeout = 10000) => {
            return new Promise((resolve, reject) => {
                if (document.querySelector(selector)) {
                    return resolve(document.querySelector(selector));
                }

                const observer = new MutationObserver(() => {
                    if (document.querySelector(selector)) {
                        observer.disconnect();
                        resolve(document.querySelector(selector));
                    }
                });

                observer.observe(document.body, {
                    childList: true,
                    subtree: true
                });

                setTimeout(() => {
                    observer.disconnect();
                    reject(new Error(`Timeout waiting for ${selector}`));
                }, timeout);
            });
        },

        findFieldByLabel: (labelText) => {
            const labels = Array.from(document.querySelectorAll('label, span'));
            const label = labels.find(l => l.textContent.trim().includes(labelText));
            if (!label) return null;

            const labelFor = label.getAttribute('for');
            if (labelFor) {
                return document.getElementById(labelFor);
            }

            const container = label.closest('.slds-form-element, .form-element, .field');
            if (container) {
                return container.querySelector('input, textarea, select');
            }

            let sibling = label.nextElementSibling;
            while (sibling) {
                const input = sibling.querySelector('input, textarea, select');
                if (input) return input;
                sibling = sibling.nextElementSibling;
            }

            return null;
        },

        findDropdownByLabel: (labelText) => {
            const spans = Array.from(document.querySelectorAll('span'));
            const labelSpan = spans.find(span => span.textContent.trim() === labelText && span.id);

            if (!labelSpan) return null;

            const dropdown = document.querySelector(`a[aria-labelledby="${labelSpan.id}"]`);
            if (dropdown) {
                debug(`Set ${labelText} using label method`);
                return dropdown;
            }
            return null;
        }
    };

    // Create Call Button
    function createCallButton() {
        const globalActions = document.querySelector('.slds-global-actions');
        if (!globalActions) {
            debug('Global actions container not found');
            return;
        }

        const buttonHtml = `
            <div class="slds-global-actions__item">
                <button id="call-button" style="
                    height: 24px;
                    background: #f5f5f7;
                    border: 1px solid #d1d1d6;
                    border-radius: 6px;
                    color: #1d1d1f;
                    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
                    font-size: 13px;
                    font-weight: bold;
                    padding: 0 8px;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    outline: none;
                " onmouseover="this.style.background='#e8e8ed'" onmouseout="this.style.background='#f5f5f7'">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                    </svg>
                    Log a Call
                </button>
            </div>
        `;

        globalActions.insertAdjacentHTML('afterbegin', buttonHtml);
        debug('Call button created');
    }

    // Create Modal
    function createModal() {
        const modalHtml = `
            <div class="modal-backdrop" style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 20000;
            ">
                <div class="custom-modal" style="
                    background: white;
                    padding: 20px;
                    border-radius: 8px;
                    min-width: 300px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                ">
                    <h3 style="margin-bottom: 15px; color: #333;">Call Information</h3>
                    <div class="slds-form">
                        <div class="slds-form-element" style="margin-bottom: 15px;">
                            <label class="slds-form-element__label" style="display: block; margin-bottom: 5px; font-weight: bold;">Reason</label>
                            <div class="slds-form-element__control">
                                <select class="slds-select" id="reason-select" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                                    <option value="">Select a reason</option>
                                    <option value="Catch-up">Catch-up</option>
                                    <option value="Performance">Performance</option>
                                    <option value="Rostering">Rostering</option>
                                    <option value="Personal Issues">Personal Issues</option>
                                </select>
                            </div>
                        </div>
                        <div class="slds-form-element" style="margin-bottom: 15px;">
                            <label class="slds-form-element__label" style="display: block; margin-bottom: 5px; font-weight: bold;">Details</label>
                            <div class="slds-form-element__control">
                                <textarea class="slds-textarea" id="details-input" placeholder="Optional details..." style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; min-height: 60px;"></textarea>
                            </div>
                        </div>
                        <div class="slds-form-element" style="margin-bottom: 15px;">
                            <label class="slds-form-element__label" style="display: block; margin-bottom: 5px; font-weight: bold;">Duration (Minutes)</label>
                            <div class="slds-form-element__control">
                                <select class="slds-select" id="duration-select" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                                    <option value="">Select duration</option>
                                    <option value="0">0</option>
                                    <option value="1">1</option>
                                    <option value="5">5</option>
                                    <option value="10">10</option>
                                    <option value="15">15</option>
                                    <option value="20">20</option>
                                    <option value="30">30</option>
                                    <option value="45">45</option>
                                    <option value="60">60</option>
                                    <option value="74">74</option>
                                    <option value="90">90</option>
                                </select>
                            </div>
                        </div>
                        <div class="slds-m-top_medium">
                            <button class="slds-button slds-button_brand" id="register-button" disabled style="
                                background: #0176d3;
                                color: white;
                                padding: 10px 20px;
                                border: none;
                                border-radius: 4px;
                                cursor: pointer;
                                opacity: 0.5;
                            ">
                                Register
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        debug('Modal created and added to DOM');
    }

    // Process Functions
    const process = {
        async showCustomModal() {
            debug('Showing custom modal');
            createModal();
            return new Promise((resolve) => {
                const modal = document.querySelector('.custom-modal');
                const reasonSelect = document.querySelector('#reason-select');
                const detailsInput = document.querySelector('#details-input');
                const durationSelect = document.querySelector('#duration-select');
                const registerButton = document.querySelector('#register-button');

                if (!modal || !reasonSelect || !detailsInput || !durationSelect || !registerButton) {
                    debug('Modal elements not found');
                    return;
                }

                const validateForm = () => {
                    const isValid = reasonSelect.value && durationSelect.value;
                    registerButton.disabled = !isValid;
                    registerButton.style.opacity = isValid ? '1' : '0.5';
                    registerButton.style.cursor = isValid ? 'pointer' : 'not-allowed';
                };

                reasonSelect.addEventListener('change', validateForm);
                durationSelect.addEventListener('change', validateForm);

                registerButton.addEventListener('click', () => {
                    if (!registerButton.disabled) {
                        const details = detailsInput.value.trim() || 'Sin detalles';
                        const data = {
                            reason: reasonSelect.value,
                            details: details,
                            duration: durationSelect.value,
                            commentString: `[AM] ${reasonSelect.value} - ${details}`
                        };
                        document.querySelector('.modal-backdrop').remove();
                        debug(`Modal data collected: ${JSON.stringify(data)}`);
                        resolve(data);
                    }
                });
            });
        },

        async createCall() {
            debug('Clicking call creation button');
            let callButton;

            // Try multiple selectors for the Log a Call button
            const selectors = [
                '.slds-icon-standard-log-a-call',
                '[class*="slds-icon-standard-log-a-call"]',
                '[data-target-selection-name="LogACallTab"]',
                '[data-key="log_a_call"]',
                '[title="Log a Call"]',
                'lightning-button-group.slds-m-vertical_xxx-small:nth-child(3) > div:nth-child(1) > slot:nth-child(1) > button:nth-child(1)',
                'lightning-button-group.slds-m-vertical_xxx-small:nth-child(3) > div:nth-child(1)'
            ];

            for (const selector of selectors) {
                try {
                    callButton = await helpers.waitForElement(selector, 2000);
                    debug(`Found call button with selector: ${selector}`);

                    // If we found an icon, get the parent button
                    if (callButton.classList.contains('slds-icon-standard-log-a-call') || callButton.classList.contains('slds-icon_container')) {
                        const parentButton = callButton.closest('button');
                        if (parentButton) {
                            callButton = parentButton;
                            debug('Using parent button element');
                        }
                    }
                    break;
                } catch {
                    debug(`Selector failed: ${selector}`);
                }
            }

            if (!callButton) {
                throw new Error('Call button not found');
            }

            debug(`About to click element: ${callButton.tagName}, classes: ${callButton.className}, text: ${callButton.textContent?.trim()}`);
            await helpers.click(callButton);
            debug('Click executed on call button');

            // Wait for call window to actually open
            debug('Waiting for call window to open...');
            await helpers.sleep(500);

            // Verify call window opened by looking for modal or call-specific elements
            const callWindowSelectors = [
                '.slds-modal',
                '.modal-container',
                '[data-aura-class*="modal"]',
                '.forceModal',
                '.uiModal'
            ];

            let callWindowFound = false;
            for (const selector of callWindowSelectors) {
                if (document.querySelector(selector)) {
                    debug(`Call window detected with selector: ${selector}`);
                    callWindowFound = true;
                    break;
                }
            }

            if (!callWindowFound) {
                debug('Call window not detected, but continuing process...');
                // throw new Error('Call window did not open after clicking button');
            }
        },

        async maximizeCallWindow() {
            debug('Maximizing call window');
            const selectors = [
                '.maxButton',
                '[class*="maxButton"]',
                '.slds-button.slds-button_icon.maxButton',
                '.maxButton > lightning-primitive-icon:nth-child(1)',
                '/html/body/div[5]/div[1]/section/div[3]/div[1]/div[3]/div/div/div/div[1]/div/div[2]/span[2]/button/lightning-primitive-icon'
            ];

            for (const selector of selectors) {
                try {
                    let maxButton;
                    if (selector.startsWith('/')) {
                        maxButton = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                    } else {
                        maxButton = await helpers.waitForElement(selector, 500);
                    }

                    if (maxButton) {
                        await helpers.click(maxButton);
                        debug('Maximized call window');
                        return;
                    }
                } catch {
                    debug(`Maximize selector failed: ${selector}`);
                }
            }
            debug('Maximize button not found, continuing...');
        },

        async fillComments(modalData) {
            debug('Filling comments field');
            let commentsField;

            try {
                commentsField = await helpers.waitForElement('#\\32 316\\:0', 500);
                debug('Found comments field by ID');
            } catch {
                commentsField = helpers.findFieldByLabel('Comments');
                if (commentsField) {
                    debug('Found comments field by label');
                } else {
                    try {
                        commentsField = await helpers.waitForElement('textarea[placeholder*="Comment"], textarea[aria-label*="Comment"]', 500);
                        debug('Found comments field by textarea selector');
                    } catch {
                        debug('Comments field not found - continuing...');
                        // throw new Error('Comments field not found - call window may not be open');
                    }
                }
            }

            await helpers.simulateTyping(commentsField, modalData.commentString);
        },

        async setConnected() {
            const dropdown = helpers.findDropdownByLabel('Connected');
            if (dropdown) {
                await helpers.click(dropdown);
                await helpers.sleep(300);
                const yesOption = await helpers.waitForElement('[title="Yes"]', 500);
                await helpers.click(yesOption);
            }
        },

        async setCategory() {
            const dropdown = helpers.findDropdownByLabel('Category');
            if (dropdown) {
                await helpers.click(dropdown);
                await helpers.sleep(300);
                const otherOption = await helpers.waitForElement('[title="Other"]', 500);
                await helpers.click(otherOption);
            }
        },

        async setMethod() {
            const dropdown = helpers.findDropdownByLabel('Method');
            if (dropdown) {
                await helpers.click(dropdown);
                await helpers.sleep(300);
                const virtualOption = await helpers.waitForElement('[title="Virtual"]', 500);
                await helpers.click(virtualOption);
            }
        },

        async setDuration(duration) {
            const dropdown = helpers.findDropdownByLabel('Duration (Minutes)');
            if (dropdown) {
                await helpers.click(dropdown);
                await helpers.sleep(300);
                const durationOption = await helpers.waitForElement(`[title="${duration}"]`, 500);
                await helpers.click(durationOption);
            }
        },



        async saveCall() {
            debug('Saving call');
            try {
                const selectors = [
                    '.slds-modal__content > div:nth-child(1) > div:nth-child(3) > div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(2) > div:nth-child(2) > button:nth-child(1) > span:nth-child(1)',
                    '/html/body/div[5]/div[1]/section/div[3]/div[1]/div[5]/div/div/div/div[2]/div/div[2]/div/div[2]/div[2]',
                    'button[title="Save"]',
                    '.slds-button--brand'
                ];

                let saveButton;
                for (const selector of selectors) {
                    try {
                        if (selector.startsWith('/')) {
                            saveButton = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                        } else {
                            saveButton = await helpers.waitForElement(selector, 500);
                        }
                        if (saveButton) break;
                    } catch {
                        continue;
                    }
                }

                if (saveButton) {
                    await helpers.click(saveButton);
                    debug('Call saved successfully');
                } else {
                    debug('Save button not found');
                }
            } catch (error) {
                debug(`Error saving call: ${error.message}`);
            }
        }
    };

    // Main process function
    async function startProcess() {
        try {
            debug('Starting Call process');

            const modalData = await process.showCustomModal();

            await process.createCall();
            await process.maximizeCallWindow();
            await process.fillComments(modalData);
            await process.setConnected();
            await process.setCategory();
            await process.setMethod();
            await process.setDuration(modalData.duration);
            await process.saveCall();

            debug('Call process completed successfully');
        } catch (error) {
            debug(`Error: ${error.message}`);
            console.error(error);
        }
    }

    // Initialize
    helpers.waitForElement('.slds-global-actions').then(() => {
        createCallButton();
        document.getElementById('call-button').addEventListener('click', startProcess);
    });
})();
