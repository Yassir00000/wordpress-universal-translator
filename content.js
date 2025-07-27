document.addEventListener('copy', (event) => {
  console.log('[ContentScript] Copy event detected!'); // Log added

  let selectedText = '';
  const activeElement = document.activeElement;

  // Check if copy occurs from input or textarea
  if (activeElement && (activeElement.tagName.toUpperCase() === 'INPUT' || activeElement.tagName.toUpperCase() === 'TEXTAREA')) {
    if (typeof activeElement.selectionStart === 'number' && typeof activeElement.selectionEnd === 'number') {
      selectedText = activeElement.value.substring(activeElement.selectionStart, activeElement.selectionEnd);
    }
  } else {
    // Otherwise, use global selection from page
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) { // Check if there's actually a selection
      const range = selection.getRangeAt(0);
      const documentFragment = range.cloneContents(); // Clone selected document part
      selectedText = documentFragment.textContent; // Get only text content, removing HTML
    }
  }

  selectedText = selectedText.trim();

  if (selectedText) {
    console.log('[ContentScript] Selected text:', selectedText); // Log added
    chrome.runtime.sendMessage({ type: "textCopied", text: selectedText }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[ContentScript] Error sending message to background:", chrome.runtime.lastError.message); // Log modified for error
        showVisualFeedback("Error sending text.", 'error');
      } else {
        console.log("[ContentScript] Message sent to background, response:", response); // Log modified for success
        // Show visual feedback only if operation was successful
        if (response && response.status === "success") {
          showVisualFeedback("Text copied and saved!", 'success');
        } else if (response && response.status === "duplicate") {
          console.log("[ContentScript] Duplicate text, no notification shown.");
          // Don't show notifications for duplicates, as requested
        } else if (response && response.status === "ignored_translation_mode_active") {
          console.log("[ContentScript] Translation mode active, text not saved, no notification shown.");
          // Don't show notifications if translation mode is active and text wasn't saved
        }
        // Other states could be handled here if necessary
      }
    });
  } else {
    console.log('[ContentScript] No text selected or selection is empty.'); // Log added
  }
});

console.log('[ContentScript] Loaded and listening for copy events.'); // Log added at end of file

// Function to show visual feedback
let translationModeActive = false;
let lastSelectedOriginalText = null;
let lastSelectedUrl = null; // New variable for selected URL

// Initialize and listen for translation mode changes
chrome.storage.local.get(['translationModeActive'], (result) => {
  translationModeActive = !!result.translationModeActive;
  console.log('[ContentScript] Initial translation mode:', translationModeActive);

  // Show banner if translation mode is active at startup
  if (translationModeActive) {
    showTranslationModeBanner();
  }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.translationModeActive) {
    translationModeActive = !!changes.translationModeActive.newValue;
    console.log('[ContentScript] Translation mode changed to:', translationModeActive);
    
    // Show or hide banner based on translation mode state
    if (translationModeActive) {
      showTranslationModeBanner();
      showLanguagePopup(); // <-- NEW CALL
    } else {
      hideTranslationModeBanner();
      hideLanguagePopup(); // <-- NEW CALL
      lastSelectedOriginalText = null; // Reset selected text if mode is disabled
      lastSelectedUrl = null; // Also reset selected URL
    }
  }
});

document.addEventListener('mouseup', (event) => {
  if (translationModeActive) {
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
      if (selectedText.startsWith('http://') || selectedText.startsWith('https://')) {
        lastSelectedUrl = selectedText;
        lastSelectedOriginalText = null; // Ensure only one mode (URL or text) is active
        console.log('[ContentScript] URL selected for translation on paste:', lastSelectedUrl);
        showVisualFeedback(`URL "${selectedText.substring(0, 50)}..." ready for translation on paste.`, 'info');
      } else {
        lastSelectedOriginalText = selectedText;
        lastSelectedUrl = null; // Ensure only one mode (URL or text) is active
        console.log('[ContentScript] Text selected for standard translation:', lastSelectedOriginalText);
        // You might want to give visual feedback here that text was "captured"
        // showVisualFeedback(`Ready to translate: "${selectedText.substring(0,30)}..."`, 'info'); // Example
      }
    }
  }
});

document.addEventListener('paste', (event) => {
  if (translationModeActive && lastSelectedUrl) {
    console.log('[ContentScript] Paste event intercepted for URL translation.');
    event.preventDefault();
    event.stopPropagation();

    const urlToTranslate = lastSelectedUrl;
    lastSelectedUrl = null; // Reset for next selection

    chrome.runtime.sendMessage({ type: "findUrlTranslation", url: urlToTranslate }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[ContentScript] Error sending findUrlTranslation message:", chrome.runtime.lastError.message);
        showVisualFeedback("Error searching for URL translation.", 'error');
        return;
      }

      if (response && response.status === "found" && response.translatedUrl !== undefined) {
        console.log('[ContentScript] URL Translation found:', response.translatedUrl);
        try {
          if (!document.execCommand('insertText', false, response.translatedUrl)) {
            console.warn('[ContentScript] document.execCommand("insertText") failed for URL. Attempting clipboard fallback.');
            navigator.clipboard.writeText(response.translatedUrl).then(() => {
                showVisualFeedback("URL translation copied to clipboard (paste manually).", 'warning');
            }).catch(err => {
                showVisualFeedback("URL translation found, but error in automatic insertion.", 'error');
            });
          } else {
            showVisualFeedback("URL translated and inserted!", 'success');
          }
        } catch (e) {
          console.error('[ContentScript] Error executing insertText for URL:', e);
          showVisualFeedback("Error inserting translated URL.", 'error');
        }
      } else if (response && response.status === "not_found") {
        console.log('[ContentScript] URL translation not found for:', urlToTranslate);
        showVisualFeedback("URL translation not found. Pasting original URL.", 'warning');
        // Paste original URL if translation is not found
        try {
            if (!document.execCommand('insertText', false, urlToTranslate)) {
                 console.warn('[ContentScript] document.execCommand("insertText") failed for original URL.');
            }
        } catch(e) {
            console.error('[ContentScript] Error executing insertText for original URL:', e);
        }
      } else {
        console.log('[ContentScript] Unexpected response from background for URL translation:', response);
        showVisualFeedback("Unexpected response for URL translation.", 'error');
      }
    });
  } else if (translationModeActive && lastSelectedOriginalText) {
    console.log('[ContentScript] Paste event intercepted in standard translation mode.');
    event.preventDefault(); 
    event.stopPropagation(); 

    const textToTranslate = lastSelectedOriginalText;
    lastSelectedOriginalText = null; 

    chrome.runtime.sendMessage({ type: "findAndReplace", originalText: textToTranslate }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[ContentScript] Error sending findAndReplace message:", chrome.runtime.lastError.message);
        showVisualFeedback("Error searching for translation.", 'error');
        return;
      }

      if (response && response.status === "found" && response.translatedText !== undefined) {
        console.log('[ContentScript] Translation found:', response.translatedText);
        try {
          // Try to insert translated text.
          // This works better if user still has focus on editable element.
          if (!document.execCommand('insertText', false, response.translatedText)) {
            // Fallback o gestione alternativa se execCommand fallisce
            console.warn('[ContentScript] document.execCommand("insertText") failed. Attempting clipboard fallback (requires clipboardWrite permission).');
            // As fallback, we could copy to clipboard and inform user,
            // ma questo cambierebbe il flusso desiderato.
            // Per ora, ci affidiamo a execCommand.
            navigator.clipboard.writeText(response.translatedText).then(() => {
                showVisualFeedback("Translation copied to clipboard (paste manually).", 'warning');
            }).catch(err => {
                showVisualFeedback("Translation found, but error in automatic insertion.", 'error');
            });
          } else {
            showVisualFeedback("Text translated and inserted!", 'success');
          }
        } catch (e) {
          console.error('[ContentScript] Error executing insertText:', e);
          showVisualFeedback("Error inserting translated text.", 'error');
        }
      } else if (response && response.status === "not_found") {
        console.log('[ContentScript] Translation not found for:', textToTranslate);
        showVisualFeedback("Translation not found.", 'warning');
      } else {
        console.log('[ContentScript] Unexpected response from background:', response);
        showVisualFeedback("Risposta inattesa dal background.", 'error');
      }
    });
  } else if (translationModeActive && !lastSelectedOriginalText && !lastSelectedUrl) {
    console.log('[ContentScript] Paste event in translation mode, but no text or URL was previously selected.');
    // Non fare nulla, lascia che l'incollaggio standard avvenga
  }
});

function showVisualFeedback(message, type = 'success') { // Modified: 'success' is default type
  const feedbackElement = document.createElement('div');
  feedbackElement.textContent = message;
  feedbackElement.style.position = 'fixed';
  feedbackElement.style.bottom = '20px';
  feedbackElement.style.right = '20px';
  feedbackElement.style.padding = '10px 20px';
  
  // Imposta il colore di sfondo in base al tipo
  switch (type) {
    case 'success':
      feedbackElement.style.backgroundColor = '#4CAF50'; // Verde
      break;
    case 'error':
      feedbackElement.style.backgroundColor = '#f44336'; // Rosso
      break;
    case 'warning':
      feedbackElement.style.backgroundColor = '#ffc107'; // Yellow/Amber
      break;
    default:
      feedbackElement.style.backgroundColor = '#4CAF50'; // Default to green
  }
  
  feedbackElement.style.color = 'white';
  // For yellow, black text might be more readable
  if (type === 'warning' || type === 'info') { // Aggiunto info per testo nero
    feedbackElement.style.color = 'black';
  }
  feedbackElement.style.borderRadius = '5px';
  feedbackElement.style.zIndex = '9999'; // Ensure it's above most elements
  feedbackElement.style.fontSize = '14px';
  feedbackElement.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
  feedbackElement.style.opacity = '0'; // Start transparent for fade-in effect
  feedbackElement.style.transition = 'opacity 0.5s ease-in-out';

  document.body.appendChild(feedbackElement);

  // Fade-in effect
  setTimeout(() => {
    feedbackElement.style.opacity = '1';
  }, 10); // Small delay to allow browser to apply initial style

  // Remove element after 3 seconds with fade-out effect
  setTimeout(() => {
    feedbackElement.style.opacity = '0';
    setTimeout(() => {
      if (feedbackElement.parentNode) {
        feedbackElement.parentNode.removeChild(feedbackElement);
      }
    }, 500); // Wait for fade-out transition to end
  }, 3000);
}

// Function to create and show "Delete Last Copy" button
function showDeleteLastButton() {
  const deleteButton = document.createElement('button');
  deleteButton.textContent = 'Delete Last Copy';
  deleteButton.style.position = 'fixed';
  deleteButton.style.bottom = '20px';
  deleteButton.style.left = '20px'; // Positioned on the left
  deleteButton.style.padding = '10px 15px';
  deleteButton.style.backgroundColor = '#ff9800'; // Arancione
  deleteButton.style.color = 'white';
  deleteButton.style.border = 'none';
  deleteButton.style.borderRadius = '5px';
  deleteButton.style.zIndex = '9998'; // Just below visual feedback
  deleteButton.style.fontSize = '12px';
  deleteButton.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
  deleteButton.style.cursor = 'pointer';

  deleteButton.addEventListener('click', () => {
    console.log('[ContentScript] "Delete Last Copy" button clicked.');
    chrome.runtime.sendMessage({ type: "deleteLastCopiedText" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[ContentScript] Error sending deleteLastCopiedText message:", chrome.runtime.lastError.message);
        showVisualFeedback("Error during deletion.", 'error');
      } else {
        console.log("[ContentScript] deleteLastCopiedText message sent, response:", response);
        if (response && response.status === "success") {
          showVisualFeedback("Last copy deleted!", 'warning'); // Modified here to use 'warning'
        } else if (response && response.status === "not_found") {
          showVisualFeedback("No copy to delete.", 'warning'); // We use 'warning' here too
        } else {
          showVisualFeedback("Operation failed.", 'error'); // Modified for clarity
        }
      }
    });
  });

  document.body.appendChild(deleteButton);
  console.log('[ContentScript] "Delete Last Copy" button added to page.');
}

// Show button when script is loaded
showDeleteLastButton();

// Function to show translation mode banner
function showTranslationModeBanner() {
  // Remove existing banner if present
  hideTranslationModeBanner();
  
  // Create banner
  const banner = document.createElement('div');
  banner.id = 'wp-translation-mode-banner';
  banner.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between;">
      <span>🔄 Translation Mode Active</span>
      <button id="wp-translation-mode-close" style="background: none; border: none; color: white; cursor: pointer; font-size: 16px;">✕</button>
    </div>
  `;
  
  // Banner styles
  banner.style.position = 'fixed';
  banner.style.top = '0';
  banner.style.left = '0';
  banner.style.width = '100%';
  banner.style.backgroundColor = '#fa6543';
  banner.style.color = 'white';
  banner.style.padding = '5px 10px';
  banner.style.boxSizing = 'border-box';
  banner.style.zIndex = '9999';
  banner.style.fontFamily = 'Arial, sans-serif';
  banner.style.fontSize = '10px';
  banner.style.fontWeight = 'bold';
  banner.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
  
  // Add banner to document
  document.body.appendChild(banner);
  
  // Add event to close banner (disable translation mode)
  document.getElementById('wp-translation-mode-close').addEventListener('click', () => {
    chrome.storage.local.set({ translationModeActive: false });
  });
}

// Function to hide translation mode banner
function hideTranslationModeBanner() {
  const existingBanner = document.getElementById('wp-translation-mode-banner');
  if (existingBanner) {
    existingBanner.remove();
  }
}

// NEW FUNCTIONS TO ADD AT END OF FILE (or in appropriate section)

function showLanguagePopup() {
  const languageSelectElement = document.getElementById('icl_post_language');
  
  // Remove previous popup if exists, to avoid duplicates
  const existingPopup = document.getElementById('language-popup-overlay');
  if (existingPopup) {
    existingPopup.remove();
  }

  const popupOverlay = document.createElement('div');
  popupOverlay.id = 'language-popup-overlay';
  popupOverlay.style.position = 'fixed';
  popupOverlay.style.top = '0';
  popupOverlay.style.left = '0';
  popupOverlay.style.width = '100%';
  popupOverlay.style.height = '100%';
  popupOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.6)'; // Semi-transparent background
  popupOverlay.style.display = 'flex';
  popupOverlay.style.justifyContent = 'center';
  popupOverlay.style.alignItems = 'center';
  popupOverlay.style.zIndex = '2147483647'; // Very high z-index value

  const popupContent = document.createElement('div');
  popupContent.style.backgroundColor = 'white';
  popupContent.style.padding = '50px'; // Increased padding
  popupContent.style.borderRadius = '15px'; // Increased border-radius
  popupContent.style.boxShadow = '0 10px 25px rgba(0,0,0,0.3)'; // More pronounced shadow
  popupContent.style.textAlign = 'center';
  popupContent.style.fontSize = '52px'; // Increased font size
  popupContent.style.fontWeight = 'bold';
  popupContent.style.color = '#333'; // Dark text color

  if (languageSelectElement) {
    const selectedOption = languageSelectElement.options[languageSelectElement.selectedIndex];
    const languageText = selectedOption ? selectedOption.text.trim() : 'Not found';
    popupContent.textContent = `Page Language: ${languageText.toUpperCase()}`;
  } else {
    console.warn('[ContentScript] Language select element #icl_post_language not found.');
    popupContent.textContent = 'Language element not found!';
    popupContent.style.color = 'red';
    popupContent.style.fontSize = '32px'; // Slightly reduced font size for error
  }

  popupOverlay.appendChild(popupContent);
  document.body.appendChild(popupOverlay);

  // Close popup on overlay click
  popupOverlay.addEventListener('click', () => {
    hideLanguagePopup();
  });

  // Close popup after certain time (e.g. 5 seconds)
  setTimeout(() => {
    hideLanguagePopup();
  }, 5000); 
}

function hideLanguagePopup() {
  const popup = document.getElementById('language-popup-overlay');
  if (popup) {
    popup.remove();
  }
}

// Ensure showVisualFeedback is defined before these new functions or is global
function showVisualFeedback(message, type = 'success') { // Modified: 'success' is default type
  const feedbackElement = document.createElement('div');
  feedbackElement.textContent = message;
  feedbackElement.style.position = 'fixed';
  feedbackElement.style.bottom = '20px';
  feedbackElement.style.right = '20px';
  feedbackElement.style.padding = '10px 20px';
  
  // Imposta il colore di sfondo in base al tipo
  switch (type) {
    case 'success':
      feedbackElement.style.backgroundColor = '#4CAF50'; // Verde
      break;
    case 'error':
      feedbackElement.style.backgroundColor = '#f44336'; // Rosso
      break;
    case 'warning':
      feedbackElement.style.backgroundColor = '#ffc107'; // Yellow/Amber
      break;
    default:
      feedbackElement.style.backgroundColor = '#4CAF50'; // Default to green
  }
  
  feedbackElement.style.color = 'white';
  // For yellow, black text might be more readable
  if (type === 'warning' || type === 'info') { // Aggiunto info per testo nero
    feedbackElement.style.color = 'black';
  }
  feedbackElement.style.borderRadius = '5px';
  feedbackElement.style.zIndex = '9999'; // Ensure it's above most elements
  feedbackElement.style.fontSize = '14px';
  feedbackElement.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
  feedbackElement.style.opacity = '0'; // Start transparent for fade-in effect
  feedbackElement.style.transition = 'opacity 0.5s ease-in-out';

  document.body.appendChild(feedbackElement);

  // Fade-in effect
  setTimeout(() => {
    feedbackElement.style.opacity = '1';
  }, 10); // Small delay to allow browser to apply initial style

  // Remove element after 3 seconds with fade-out effect
  setTimeout(() => {
    feedbackElement.style.opacity = '0';
    setTimeout(() => {
      if (feedbackElement.parentNode) {
        feedbackElement.parentNode.removeChild(feedbackElement);
      }
    }, 500); // Wait for fade-out transition to end
  }, 3000);
}
