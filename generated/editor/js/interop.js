// This is a JavaScript module that is loaded on demand. It can export any number of
// functions, and may import other JavaScript modules if required.

export function setFocusToCanvas() {
    getCanvas()?.focus();
}

export function getCanvas() {
    const canvas = document.getElementsByTagName("canvas");
    if (canvas.length > 0) {
        return canvas[0];
    }
    return null;
}

export function getOS() {
    let userAgent = window.navigator.userAgent;
    let platform = window.navigator.platform;
    let macosPlatforms = ['Macintosh', 'MacIntel', 'MacPPC', 'Mac68K'];
    let windowsPlatforms = ['Win32', 'Win64', 'Windows', 'WinCE'];
    let iosPlatforms = ['iPhone', 'iPad', 'iPod'];
    let os = null;

    if (macosPlatforms.indexOf(platform) !== -1) {
        os = 'macos';
    } else if (iosPlatforms.indexOf(platform) !== -1) {
        os = 'ios';
    } else if (windowsPlatforms.indexOf(platform) !== -1) {
        os = 'windows';
    } else if (/Android/.test(userAgent)) {
        os = 'android';
    } else if (!os && /Linux/.test(platform)) {
        os = 'linux';
    }

    return os;
}

export function elementExistsById(elementId) {
    return !!document.getElementById(elementId);
}

export function saveAsFile(filename, bytesBase64) {
    var link = document.createElement('a');
    link.download = filename;
    link.href = 'data:application/octet-stream;base64,' + bytesBase64;
    document.body.appendChild(link); // Required for Firefox
    link.click();
    document.body.removeChild(link);
}

// Resource fetching methods for VS Code mode
// These bypass HttpClient to avoid System.Uri validation issues with file+.vscode-resource URLs

export async function fetchBinary(url) {
    console.log('[JS Fetch] Fetching binary:', url);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
}

export async function fetchText(url) {
    console.log('[JS Fetch] Fetching text:', url);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.text();
}


export function getElementContent(element) {
  if (!element) return "";
    return element.innerText;
}

export function setElementContent(element, content) {
  if (!element) return;
    element.innerText = content;
}

export function getBoundingClientRect (element) {
    if (!element) {
        return null;
    }

    // If the element itself has 0 dimensions but has a child with dimensions,
    // this likely means the child has position:fixed or absolute which takes it out of flow.
    // In this case, measure the first child instead.
    if (element.offsetWidth === 0 && element.offsetHeight === 0 && element.children.length > 0) {
        const child = element.children[0];
        if (child.offsetWidth > 0 || child.offsetHeight > 0) {
            // console.log('getBoundingClientRect: Parent has 0 dimensions, using child dimensions instead');
            return child.getBoundingClientRect();
        }
    }

    return element.getBoundingClientRect();
}

export async function getBoundingClientRectWithRetry(element, maxRetries = 5, delayMs = 50) {
    if (!element) return null;

    for (let i = 0; i < maxRetries; i++) {
        // Wait for next animation frame to ensure layout is complete
        await new Promise(resolve => requestAnimationFrame(resolve));

        const rect = element.getBoundingClientRect();
        console.log(`Retry ${i + 1}: width=${rect.width}, height=${rect.height}`);

        if (rect.width > 0 && rect.height > 0) {
            return rect;
        }

        // Additional delay between retries
        if (i < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    // Return the last rect even if dimensions are 0
    return element.getBoundingClientRect();
}

export function setDocumentTitle(title) {
    document.title = title;
}

export function setupCanvasWheelHandler(dotnetHelper) {
    const canvas = getCanvas();
    if (!canvas) return;

    // Remove existing listener if any
    if (canvas._wheelHandler) {
        canvas.removeEventListener('wheel', canvas._wheelHandler);
    }

    // Create new wheel handler
    const wheelHandler = (e) => {
        if (e.ctrlKey) {
            // Prevent browser zoom when Ctrl is pressed
            e.preventDefault();

            // Call back to C# to handle canvas zoom
            dotnetHelper.invokeMethodAsync('OnWheelJS',
                e.deltaY,
                e.clientX,
                e.clientY,
                e.ctrlKey
            );
        }
        // If Ctrl not pressed, allow normal scrolling
    };

    canvas._wheelHandler = wheelHandler;
    canvas.addEventListener('wheel', wheelHandler, { passive: false });
}

// ============================================================================
// EXTENDED TOOLTIP FUNCTIONALITY (from extendedTooltip.js)
// ============================================================================

// Store event handlers for cleanup
const tooltipHandlers = new Map();
const TOOLTIP_DELAY_MS = 300;

export function initializeTooltip(anchorId, tooltipElementRef) {
    const anchorElement = document.getElementById(anchorId);

    if (!anchorElement) {
        console.warn(`Anchor element with id '${anchorId}' not found`);
        return;
    }

    // The tooltipElementRef passed from Blazor is the actual DOM element
    const tooltipElement = tooltipElementRef;

    if (!tooltipElement) {
        console.warn(`Tooltip element not found for anchor '${anchorId}'`);
        return;
    }

    // Move tooltip to the tooltip-container (only if not already there)
    const tooltipContainer = document.getElementById('tooltip-container');
    if (tooltipContainer && tooltipElement.parentElement !== tooltipContainer) {
        tooltipContainer.appendChild(tooltipElement);
    }

    // console.log(`Tooltip element initialized for '${anchorId}'`);

    // Position tooltip relative to anchor
    function positionTooltip() {
        const anchorRect = anchorElement.getBoundingClientRect();

        // Make tooltip visible temporarily to measure it
        const wasHidden = tooltipElement.style.display === 'none';
        if (wasHidden) {
            tooltipElement.style.visibility = 'hidden';
            tooltipElement.style.display = 'block';
        }

        const tooltipRect = tooltipElement.getBoundingClientRect();
        const tooltipContent = tooltipElement.querySelector('.tooltip-content');
        const tooltipArrow = tooltipElement.querySelector('.tooltip-arrow');

        // Get position (top/bottom/left/right)
        let position = 'bottom'; // default
        if (tooltipContent?.classList.contains('top')) {
            position = 'top';
        } else if (tooltipContent?.classList.contains('left')) {
            position = 'left';
        } else if (tooltipContent?.classList.contains('right')) {
            position = 'right';
        }

        // Get alignment (left/center/right) - case insensitive
        let align = 'center'; // default
        if (tooltipContent?.classList.contains('align-left') || tooltipContent?.classList.contains('align-Left')) {
            align = 'left';
        } else if (tooltipContent?.classList.contains('align-right') || tooltipContent?.classList.contains('align-Right')) {
            align = 'right';
        }

        // Calculate tooltip position
        let tooltipLeft, tooltipTop;
        let arrowLeft, arrowTop;

        const gap = 3; // Gap between tooltip and anchor
        const anchorCenterX = anchorRect.left + (anchorRect.width / 2);
        const anchorCenterY = anchorRect.top + (anchorRect.height / 2);

        if (position === 'top' || position === 'bottom') {
            // Vertical positioning (tooltip above or below anchor)

            // Vertical position
            if (position === 'top') {
                tooltipTop = anchorRect.top - tooltipRect.height - gap;
            } else {
                tooltipTop = anchorRect.bottom + gap;
            }

            // Horizontal position based on alignment
            if (align === 'left') {
                // Tooltip left edge aligns with anchor left edge
                tooltipLeft = anchorRect.left;
                // Arrow points to anchor center
                arrowLeft = anchorCenterX - anchorRect.left;
            } else if (align === 'right') {
                // Tooltip right edge aligns with anchor right edge
                tooltipLeft = anchorRect.right - tooltipRect.width;
                // Arrow points to anchor center
                arrowLeft = anchorCenterX - (anchorRect.right - tooltipRect.width);
            } else {
                // Center alignment
                tooltipLeft = anchorCenterX - (tooltipRect.width / 2);
                // Arrow centered
                arrowLeft = tooltipRect.width / 2;
            }

            // Arrow vertical position
            if (tooltipArrow) {
                tooltipArrow.style.left = `${arrowLeft}px`;
                tooltipArrow.style.transform = 'translateX(-50%)';

                if (position === 'top') {
                    // Tooltip is above anchor, arrow points DOWN (at bottom of tooltip)
                    tooltipArrow.style.top = 'auto';
                    tooltipArrow.style.bottom = '-2px'; // Arrow is 5px tall
                } else {
                    // Tooltip is below anchor, arrow points UP (at top of tooltip)
                    tooltipArrow.style.top = '-6px'; // Arrow is 5px tall
                    tooltipArrow.style.bottom = 'auto';
                }
            }

        } else if (position === 'left' || position === 'right') {
            // Horizontal positioning (tooltip left or right of anchor)

            // Get the actual content height (not wrapper height)
            const contentRect = tooltipContent ? tooltipContent.getBoundingClientRect() : tooltipRect;

            // Horizontal position
            if (position === 'left') {
                tooltipLeft = anchorRect.left - tooltipRect.width - gap;
            } else {
                tooltipLeft = anchorRect.right + gap;
            }

            // Vertical position based on alignment
            if (align === 'left') {
                // Tooltip top edge aligns with anchor top edge
                tooltipTop = anchorRect.top;
                // Arrow points to anchor center
                arrowTop = anchorCenterY - anchorRect.top;
            } else if (align === 'right') {
                // Tooltip bottom edge aligns with anchor bottom edge
                tooltipTop = anchorRect.bottom - tooltipRect.height;
                // Arrow points to anchor center
                arrowTop = anchorCenterY - (anchorRect.bottom - tooltipRect.height);
            } else {
                // Center alignment - center the content (not wrapper) on anchor
                tooltipTop = anchorCenterY - (contentRect.height / 2);
                // Arrow centered relative to content
                arrowTop = contentRect.height / 2;
            }

            // Arrow horizontal position
            if (tooltipArrow) {
                tooltipArrow.style.top = `${arrowTop}px`;
                tooltipArrow.style.transform = 'translateY(-50%)';
                tooltipArrow.style.bottom = 'auto';

                if (position === 'left') {
                    // Tooltip is left of anchor, arrow points RIGHT (at right edge of tooltip)
                    tooltipArrow.style.left = 'auto';
                    tooltipArrow.style.right = '-6px'; // Arrow is 5px wide
                } else {
                    // Tooltip is right of anchor, arrow points LEFT (at left edge of tooltip)
                    tooltipArrow.style.left = '-6px'; // Arrow is 5px wide
                    tooltipArrow.style.right = 'auto';
                }
            }
        }

        // Apply tooltip position
        tooltipElement.style.left = `${tooltipLeft}px`;
        tooltipElement.style.top = `${tooltipTop}px`;
        tooltipElement.style.transform = 'none'; // Remove any transform

        // Restore visibility
        if (wasHidden) {
            tooltipElement.style.display = 'none';
            tooltipElement.style.visibility = 'visible';
        }
    }

    // Show tooltip
    function showTooltip() {
        positionTooltip();
        tooltipElement.style.display = 'block';
    }

    // Hide tooltip
    function hideTooltip() {
        tooltipElement.style.display = 'none';
    }

    // Timeout ID for delayed tooltip display
    let showTimeoutId = null;

    // Event handlers
    const showHandler = () => {
        // Clear any existing timeout
        if (showTimeoutId) {
            clearTimeout(showTimeoutId);
        }
        // Show tooltip after delay
        showTimeoutId = setTimeout(() => {
            showTooltip();
            showTimeoutId = null;
        }, TOOLTIP_DELAY_MS);
    };

    const hideHandler = () => {
        // Clear pending show timeout
        if (showTimeoutId) {
            clearTimeout(showTimeoutId);
            showTimeoutId = null;
        }
        hideTooltip();
    };

    // Attach event listeners
    anchorElement.addEventListener('mouseenter', showHandler);
    anchorElement.addEventListener('mouseleave', hideHandler);
    anchorElement.addEventListener('click', hideHandler);
    anchorElement.addEventListener('contextmenu', hideHandler);

    // Store handlers for cleanup
    tooltipHandlers.set(anchorId, {
        element: anchorElement,
        tooltipElement: tooltipElement,
        showHandler,
        hideHandler
    });
}

export function cleanupTooltip(anchorId) {
    const handlers = tooltipHandlers.get(anchorId);

    if (handlers) {
        const { element, tooltipElement, showHandler, hideHandler } = handlers;
        element.removeEventListener('mouseenter', showHandler);
        element.removeEventListener('mouseleave', hideHandler);
        element.removeEventListener('click', hideHandler);
        element.removeEventListener('contextmenu', hideHandler);

        // Don't remove tooltip from container - let Blazor handle it
        // The element will be cleaned up by Blazor's disposal

        tooltipHandlers.delete(anchorId);
    }
}

// ============================================================================
// KEYCODE FUNCTIONALITY (from keycode.js)
// ============================================================================

export function RegisterKeyCode(globalDocument, eventNames, id, elementRef, onlyCodes, excludeCodes, stopPropagation, preventDefault, preventDefaultOnly, dotNetHelper, preventMultipleKeydown) {
    const element = globalDocument
                  ? document
                  : elementRef == null ? document.getElementById(id) : elementRef;

    if (document.fluentKeyCodeEvents == null) {
        document.fluentKeyCodeEvents = {};
    }

    if (!!element) {

        const eventId = Math.random().toString(36).slice(2);
        let fired = false;

        const handlerKeydown = function (e) {
            if (!fired || !preventMultipleKeydown) {
                fired = true;
                return handler(e, "OnKeyDownRaisedAsync");
            }
        }

        const handlerKeyup = function (e) {
            fired = false;
            return handler(e, "OnKeyUpRaisedAsync");
        }

        const handler = function (e, netMethod) {
            const keyCode = e.which || e.keyCode || e.charCode;

            if (!!dotNetHelper && !!dotNetHelper.invokeMethodAsync) {

                const targetId = e.target === document.body ? "body" : (e.target?.dataset?.testid ?? e.target?.id ?? "");
                const isPreventDefault = preventDefault || (preventDefaultOnly.length > 0 && preventDefaultOnly.includes(keyCode));
                const isStopPropagation = stopPropagation;

                // Exclude
                if (excludeCodes.length > 0 && excludeCodes.includes(keyCode)) {
                    if (isPreventDefault) {
                        e.preventDefault();
                    }
                    if (isStopPropagation) {
                        e.stopPropagation();
                    }
                    return;
                }

                // All or Include only
                if (onlyCodes.length == 0 || (onlyCodes.length > 0 && onlyCodes.includes(keyCode))) {
                    if (isPreventDefault) {
                        e.preventDefault();
                    }
                    if (isStopPropagation) {
                        e.stopPropagation();
                    }
                    dotNetHelper.invokeMethodAsync(netMethod, keyCode, e.key, e.ctrlKey, e.shiftKey, e.altKey, e.metaKey, e.location, e.repeat, targetId);
                    return;
                }
            }
        };

        if (preventMultipleKeydown || (!!eventNames && eventNames.includes("KeyDown"))) {
            element.addEventListener('keydown', handlerKeydown)
        }
        if (preventMultipleKeydown || (!!eventNames && eventNames.includes("KeyUp"))) {
            element.addEventListener('keyup', handlerKeyup)
        }
        document.fluentKeyCodeEvents[eventId] = { source: element, handlerKeydown, handlerKeyup };

        return eventId;
    }
    else {
        console.error(`element is not ready for keycode registration: ${id}`);
    }

    return "";
}

export function UnregisterKeyCode(eventId) {

    if (document.fluentKeyCodeEvents != null) {
        const keyEvent = document.fluentKeyCodeEvents[eventId];
        const element = keyEvent.source;

        if (!!keyEvent.handlerKeydown) {
            element.removeEventListener("keydown", keyEvent.handlerKeydown);
        }

        if (!!keyEvent.handlerKeyup) {
            element.removeEventListener("keyup", keyEvent.handlerKeyup);
        }

        delete document.fluentKeyCodeEvents[eventId];
    }
}
