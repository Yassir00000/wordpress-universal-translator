document.addEventListener('DOMContentLoaded', () => {
  const jsonEditorArea = document.getElementById('jsonEditorArea'); // Changed from outputDiv
  const clearButton = document.getElementById('clearButton');
  const copyJsonButton = document.getElementById('copyJsonButton');
  const toggleTranslationButton = document.getElementById('toggleTranslationButton');
  const requestOpenAITranslationsButton = document.getElementById('requestOpenAITranslationsButton'); // New button
  const searchInput = document.getElementById('searchInput'); // New: search input
  const searchButton = document.getElementById('searchButton'); // New: search button
  const resetSearchButton = document.getElementById('resetSearchButton'); // New: search reset button
// === Checkbox and container ===
const tipoContainer = document.getElementById('tipoContainer');
const tipoCheckbox  = document.getElementById('tipoCheckbox');

// Values to assign to the first 6 elements
const tipoValues = ['Title_50-70_caratteri', 'H1', 'Primo_paragrafo', 'Focus_keyphrase', 'SEO_Title_50-70_caratteri', 'Meta_description_120-157_Caratteri'];

  let internalChange = false;
  let allTextsCache = []; // Cache for all texts

  // Initialize Translation button state
  chrome.storage.local.get(['translationModeActive'], (result) => {
    const isActive = !!result.translationModeActive;
    updateTranslationButton(isActive);
  });
  chrome.storage.local.get(['copiedTexts', 'tipoCheckboxChecked'], (res) => {
    allTextsCache = res.copiedTexts || [];
    displayTexts(allTextsCache);
  
    // Show checkbox only if there are at least 6 elements
    if (allTextsCache.length >= 6) {
      tipoContainer.style.display = 'block';
      tipoCheckbox.checked = !!res.tipoCheckboxChecked;
      if (tipoCheckbox.checked) applyTipoValues(allTextsCache);
    }
  });
  
  function updateTranslationButton(isActive) {
    if (isActive) {
      toggleTranslationButton.textContent = 'Translation (Active)';
      toggleTranslationButton.classList.add('active');
    } else {
      toggleTranslationButton.textContent = 'Activate Translation';
      toggleTranslationButton.classList.remove('active');
    }
  }

  toggleTranslationButton.addEventListener('click', () => {
    chrome.storage.local.get(['translationModeActive'], (result) => {
      const currentMode = !!result.translationModeActive;
      const newMode = !currentMode;
      chrome.storage.local.set({ translationModeActive: newMode }, () => {
        updateTranslationButton(newMode);
        console.log(`Translation mode set to: ${newMode}`);
      });
    });
  });

  function displayTexts(textsToDisplay) {
    // Se textsToDisplay non è fornito, usa la cache o carica dallo storage
    if (textsToDisplay === undefined) {
      if (allTextsCache.length > 0) {
        try {
          jsonEditorArea.value = JSON.stringify(allTextsCache, null, 2);
          jsonEditorArea.style.borderColor = '';
        } catch (e) {
          jsonEditorArea.value = "Error formatting JSON data from cache.";
          console.error("Error stringify JSON from cache:", e);
          jsonEditorArea.style.borderColor = 'red';
        }
      } else {
        // Load from storage if cache is empty
        chrome.storage.local.get(["copiedTexts"], (result) => {
          allTextsCache = result.copiedTexts || [];
          try {
            jsonEditorArea.value = JSON.stringify(allTextsCache, null, 2);
            jsonEditorArea.style.borderColor = '';
          } catch (e) {
            jsonEditorArea.value = "Error formatting JSON data.";
            console.error("Error stringify JSON:", e);
            jsonEditorArea.style.borderColor = 'red';
          }
        });
      }
    } else {
      // Se textsToDisplay è fornito (es. risultati di ricerca), visualizzali
      try {
        jsonEditorArea.value = JSON.stringify(textsToDisplay, null, 2);
        jsonEditorArea.style.borderColor = '';
      } catch (e) {
        jsonEditorArea.value = "Error formatting filtered JSON data.";
        console.error("Error stringify filtered JSON:", e);
        jsonEditorArea.style.borderColor = 'red';
      }
    }
  }

  // Load and display texts at startup, populating cache
  chrome.storage.local.get(["copiedTexts"], (result) => {
    allTextsCache = result.copiedTexts || [];
    displayTexts(allTextsCache);
  });

  jsonEditorArea.addEventListener('input', () => {
    try {
      const updatedTexts = JSON.parse(jsonEditorArea.value);
      if (Array.isArray(updatedTexts)) {
        internalChange = true;
        chrome.storage.local.set({ copiedTexts: updatedTexts }, () => {
          jsonEditorArea.style.borderColor = 'green'; // Temporary positive feedback
          setTimeout(() => { jsonEditorArea.style.borderColor = ''; }, 1000);
        });
      } else {
        jsonEditorArea.style.borderColor = 'red'; // Not an array
      }
    } catch (e) {
      jsonEditorArea.style.borderColor = 'red'; // Invalid JSON
      // Don't save if JSON is invalid
    }
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    tipoContainer.style.display = allTextsCache.length >= 5 ? 'block' : 'none';
    if (namespace === 'local' && changes.copiedTexts) {
      allTextsCache = changes.copiedTexts.newValue || []; // Aggiorna la cache
      if (internalChange) {
        internalChange = false;
        return;
      }
      // If no active search, update view with all texts
      if (searchInput.value.trim() === '') {
        displayTexts(allTextsCache);
      } else {
        // If there's an active search, reapply filter to new data
        performSearch();
      }
    }
  });
  tipoCheckbox.addEventListener('change', () => {
    const checked = tipoCheckbox.checked;
    chrome.storage.local.set({ tipoCheckboxChecked: checked });
  
    chrome.storage.local.get(['copiedTexts'], ({ copiedTexts = [] }) => {
      const texts = [...copiedTexts];      // safe clone
      if (checked) {
        applyTipoValues(texts);
      } else {
        removeTipoValues(texts);
      }
      chrome.storage.local.set({ copiedTexts: texts }, () => {
        allTextsCache = texts;
        displayTexts(texts);
      });
    });
  });
  function applyTipoValues(arr) {
    for (let i = 0; i < 6 && i < arr.length; i++) arr[i].Tipo_elemento = tipoValues[i];
  }
  function removeTipoValues(arr) {
    for (let i = 0; i < 6 && i < arr.length; i++) delete arr[i].Tipo_elemento;
  }
  
  clearButton.addEventListener('click', () => {
    if (confirm("Are you sure you want to delete all copied texts?")) {
      internalChange = true;
      chrome.storage.local.set({ copiedTexts: [] }, () => {
        // displayTexts() will be called from onChanged or we can call it directly
        // if internalChange blocks update from onChanged in this specific case.
        // For safety, we call it here.
        jsonEditorArea.value = '[]'; // Directly cleans the textarea
        jsonEditorArea.style.borderColor = '';
        console.log("All texts have been deleted.");
      });
    }
  });

  copyJsonButton.addEventListener('click', () => {
    const jsonString = jsonEditorArea.value; // Copy directly from textarea
    if (!jsonString || jsonString === "[]") {
      alert("No text to copy.");
      return;
    }
    // Try to validate/format before copying, if content is valid JSON
    try {
        const parsedJson = JSON.parse(jsonString);
        const formattedJsonString = JSON.stringify(parsedJson, null, 2);
        navigator.clipboard.writeText(formattedJsonString)
          .then(() => {
            const originalText = copyJsonButton.textContent;
            copyJsonButton.textContent = 'JSON Copied!';
            copyJsonButton.disabled = true;
            setTimeout(() => {
              copyJsonButton.textContent = originalText;
              copyJsonButton.disabled = false;
            }, 2000);
          })
          .catch(err => {
            console.error('Error copying JSON: ', err);
            alert('Error copying JSON. Check console for details.');
          });
    } catch (e) {
        alert('JSON content is invalid. Please fix it before copying.');
    }
  });

  // "Request OpenAI Translations" button functionality
  requestOpenAITranslationsButton.addEventListener('click', () => {
    requestOpenAITranslationsButton.disabled = true;
    requestOpenAITranslationsButton.textContent = 'Translation in progress...';

    chrome.storage.local.get(["copiedTexts"], (result) => {
      const textsToTranslate = (result.copiedTexts || []).filter(entry => !entry.Testo_tradotto); // Translate only if Testo_tradotto is empty

      if (textsToTranslate.length === 0) {
        alert("No new text to translate or all texts already have translations.");
        requestOpenAITranslationsButton.disabled = false;
        requestOpenAITranslationsButton.textContent = 'Request OpenAI Translations';
        return;
      }

      // Send only ID and Testo_originale for translation
      const textsForAPI = textsToTranslate.map(entry => ({
        ID: entry.ID,
        Testo_originale: entry.Testo_originale
      }));

      chrome.runtime.sendMessage({ type: "requestOpenAITranslations", texts: textsForAPI }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Error sending message to background:", chrome.runtime.lastError.message);
          alert("Error during translation request: " + chrome.runtime.lastError.message);
        } else if (response) {
          if (response.status === "success") {
            alert("Translations requested successfully! Texts will be updated shortly.");
            // UI update will happen via chrome.storage.onChanged
          } else {
            alert("Error from translation request: " + (response.error || "Unknown error"));
          }
        }
        requestOpenAITranslationsButton.disabled = false;
        requestOpenAITranslationsButton.textContent = 'Request OpenAI Translations';
      });
    });
  });

  // New search logic
  function performSearch() {
    const searchTerm = searchInput.value.trim().toLowerCase();
    if (!searchTerm) {
      displayTexts(allTextsCache); // Show all texts if search is empty
      return;
    }

    const filteredTexts = allTextsCache.filter(entry => {
      const originalText = entry.Testo_originale ? entry.Testo_originale.toLowerCase() : '';
      const translatedText = entry.Testo_tradotto ? entry.Testo_tradotto.toLowerCase() : '';
      return originalText.includes(searchTerm) || translatedText.includes(searchTerm);
    });

    displayTexts(filteredTexts); // Show filtered texts
  }

  searchButton.addEventListener('click', performSearch);

  searchInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      performSearch();
    }
  });

  resetSearchButton.addEventListener('click', () => {
    searchInput.value = ''; // Clear search field
    displayTexts(allTextsCache); // Show all texts again
  });

});
