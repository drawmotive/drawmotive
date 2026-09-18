window.hasChildWithClass = (parentId, className) => {
  const parent = document.getElementById(parentId);
  if (!parent) return false;
  return parent.querySelector(`.${className}`) !== null;
};

// Font loading has been moved to site.css to avoid CSP violations
const RETRY_DELAY = 5000; // 5 seconds

window.ddReportError = (message) => {
  if (window.DD_LOGS && window.DD_LOGS.logger) {
    // DataDog is ready, process the error
    window.DD_LOGS.logger.error('', JSON.parse(message));
  } else {
    setTimeout(() => {
      if (window.DD_LOGS && window.DD_LOGS.logger) {
        window.DD_LOGS.logger.error('', JSON.parse(message));
      }
    }, RETRY_DELAY);
  }
};

// Loading screen blocker functions
window.ddShowLoadingBlocker = () => {
  // Remove existing blocker if any
  const existing = document.getElementById('dd-loading-blocker');
  if (existing) {
    existing.remove();
  }

  // Create screen blocker
  const blocker = document.createElement('div');
  blocker.id = 'dd-loading-blocker';
  blocker.className = 'dd-loading-blocker';

  document.body.appendChild(blocker);
};

window.ddShowLoadingAnimation = (message = 'Loading...', title = 'Please wait') => {
  ddShowLoadingBlocker();
  const blocker = document.getElementById('dd-loading-blocker');
  if (!blocker) return;

  // Create loading animation container
  const loadingContainer = document.createElement('div');
  loadingContainer.id = 'dd-loading-animation';
  loadingContainer.className = 'dd-loading-animation';

  // Create spinner
  const spinner = document.createElement('div');
  spinner.className = 'dd-loading-spinner';

  // Create title
  const titleElement = document.createElement('h4');
  titleElement.textContent = title;
  titleElement.className = 'dd-loading-title';

  // Create message
  const messageElement = document.createElement('p');
  messageElement.textContent = message;
  messageElement.className = 'dd-loading-message';

  // Assemble the loading animation
  loadingContainer.appendChild(spinner);
  loadingContainer.appendChild(titleElement);
  loadingContainer.appendChild(messageElement);
  blocker.appendChild(loadingContainer);
};

window.ddHideLoadingAnimation = () => {
  const blocker = document.getElementById('dd-loading-blocker');
  if (blocker) {
    blocker.remove();
  }
};
