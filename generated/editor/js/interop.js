// This is a JavaScript module that is loaded on demand. It can export any number of
// functions, and may import other JavaScript modules if required.

export function setFocusToCanvas() {
    getCanvas()?.focus();
}

export function getCanvas() {
    // The host may contain other canvases; only the native editor owns input.
    return document.querySelector('.drawmotive-canvas-host canvas')
        ?? document.querySelector('.canvas-container canvas');
}

// Release native listeners before their managed references and document scope close.
export function cleanupCanvasHandlers() {
    const canvas = getCanvas();
    if (!canvas) return;
    if (canvas._wheelHandler) canvas.removeEventListener('wheel', canvas._wheelHandler);
    if (canvas._focusHandler) canvas.removeEventListener('pointerdown', canvas._focusHandler);
    delete canvas._wheelHandler;
    delete canvas._focusHandler;
}

export function setupCanvasFocusHandler() {
    const canvas = getCanvas();
    if (!canvas) return;
    if (canvas._focusHandler) {
        canvas.removeEventListener('pointerdown', canvas._focusHandler);
    }

    // Native canvas focus keeps document shortcuts out of host inputs and React menus.
    canvas.tabIndex = 0;
    canvas._focusHandler = event => {
        canvas.focus({ preventScroll: true });
        // Native gestures consume compatible mouse events. Capture keeps their
        // release on this canvas even when the pointer moves over host chrome.
        if (event.pointerId !== undefined && canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerdown', canvas._focusHandler);
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
            const rect = canvas.getBoundingClientRect();
            dotnetHelper.invokeMethodAsync('OnWheelJS',
                e.deltaY,
                e.clientX - rect.left,
                e.clientY - rect.top,
                e.ctrlKey
            );
        }
        // If Ctrl not pressed, allow normal scrolling
    };

    canvas._wheelHandler = wheelHandler;
    canvas.addEventListener('wheel', wheelHandler, { passive: false });
}
