/* background.js */

let urlTranslations = [];
let keywords = [];  // here we'll put the keywords

// load Keywords.txt from extension and parse JSON
async function loadKeywords() {
  try {
    const url = chrome.runtime.getURL("Keywords.txt");
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[BackgroundScript] Error loading Keywords.txt: ${response.statusText}`);
      return;
    }
    const text = await response.text();
    keywords = JSON.parse(text);
    console.log("[BackgroundScript] Keywords loaded:", keywords);
  } catch (e) {
    console.error("[BackgroundScript] Exception during loadKeywords:", e);
  }
}

// Load keywords immediately at service worker start
loadKeywords();
// *** FIX ──────────────────────────────────────────────────────────────
function safeParseTranslations(raw) {
    // 1) Try "clean" JSON parse
    try {
      const parsed = JSON.parse(raw);
  
      // a) Array already correct
      if (Array.isArray(parsed)) {
        return parsed;
      }
  
      // b) Oggetto singolo { ID: "...", Testo_tradotto: "..." }
      if (
        parsed &&
        typeof parsed === "object" &&
        "ID" in parsed &&
        "Testo_tradotto" in parsed
      ) {
        return [
          {
            ID: parsed.ID,
            Testo_tradotto: parsed.Testo_tradotto,
          },
        ];
      }
  
      // c) Oggetto “mappa” { "1": "trad 1", "2": "trad 2" } o simili
      if (parsed && typeof parsed === "object") {
        return Object.entries(parsed)
          .map(([key, value]) => {
            if (typeof value === "string") {
              return { ID: key, Testo_tradotto: value };
            }
            if (
              value &&
              typeof value === "object" &&
              "Testo_tradotto" in value
            ) {
              return {
                ID: value.ID || key,
                Testo_tradotto: value.Testo_tradotto,
              };
            }
            return null;
          })
          .filter(Boolean);
      }
    } catch (_) {
      /* parse fallito: passeremo alla regex */
    }
  
    // 2) Fallback regex: estrae coppie "ID" / "Testo_tradotto"
    const regex =
      /"ID"\s*:\s*"([^"]+)"\s*,\s*"Testo_tradotto"\s*:\s*"([^"]*?)"\s*(?:,|\})/g;
    const out = [];
    let match;
    while ((match = regex.exec(raw)) !== null) {
      out.push({ ID: match[1], Testo_tradotto: match[2] });
    }
    return out;
  }
  // *** END FIX ──────────────────────────────────────────────────────────
  

// Funzione per caricare le traduzioni degli URL
async function loadUrlTranslations() {
  try {
    const response = await fetch(chrome.runtime.getURL("url_translations.json"));
    if (!response.ok) {
      console.error(
        `Errore nel caricare url_translations.json: ${response.statusText}`
      );
      urlTranslations = [];
      return;
    }
    urlTranslations = await response.json();
    console.log("[BackgroundScript] Traduzioni URL caricate:", urlTranslations);
  } catch (error) {
    console.error(
      "[BackgroundScript] Eccezione durante il caricamento di url_translations.json:",
      error
    );
    urlTranslations = [];
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ copiedTexts: [] });
  console.log(
    "Extension 'WordPress Translation Assistant' installed and storage initialized."
  );
  loadUrlTranslations(); // Carica le traduzioni URL all'installazione/aggiornamento
});

// Carica le traduzioni URL anche all'avvio del service worker (non solo all'installazione)
loadUrlTranslations();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[BackgroundScript] Message received:", request); // Log aggiunto
  if (request.type === "textCopied") {
    const textToSave = request.text;
    // Recupera sia copiedTexts che translationModeActive
    chrome.storage.local.get(
      ["copiedTexts", "translationModeActive"],
      (result) => {
        const translationMode = !!result.translationModeActive; // Assicura che sia un booleano

        if (translationMode) {
          // Se la modalità traduzione è attiva, non salvare il testo
          console.log(
            "[BackgroundScript] Modalità traduzione attiva. Testo non salvato:",
            textToSave
          );
          sendResponse({
            status: "ignored_translation_mode_active",
            message: "Testo non salvato, modalità traduzione attiva.",
          });
        } else {
          // Altrimenti, procedi con il salvataggio
          let texts = result.copiedTexts || [];

          // Controlla se il testo esiste già
          const existingText = texts.find(
            (entry) => entry.Testo_originale === textToSave
          );
          if (existingText) {
            console.log(
              "[BackgroundScript] Testo già esistente, non salvato:",
              textToSave
            );
            sendResponse({
              status: "duplicate",
              message: "Testo già esistente, non salvato.",
            });
            return; // Esce dalla funzione per non salvare il duplicato
          }

          const newId =
            texts.length > 0
              ? (parseInt(texts[texts.length - 1].ID) + 1).toString()
              : "1"; // Gestisce ID incrementale corretto
          const newEntry = {
            ID: newId,
            Testo_originale: textToSave,
            Testo_tradotto: "", // Lasciato vuoto come richiesto
          };
          texts.push(newEntry);
          chrome.storage.local.set({ copiedTexts: texts }, () => {
            console.log("[BackgroundScript] Testo salvato:", newEntry); // Log modificato
            sendResponse({ status: "success", data: newEntry });
          });
        }
      }
    );
    return true; // Necessario per indicare che sendResponse sarà chiamata in modo asincrono
  } else if (request.type === "deleteLastCopiedText") {
    chrome.storage.local.get(["copiedTexts"], (result) => {
      let texts = result.copiedTexts || [];
      if (texts.length > 0) {
        const removedText = texts.pop(); // Rimuove l'ultimo elemento
        chrome.storage.local.set({ copiedTexts: texts }, () => {
          console.log("[BackgroundScript] Ultima copia rimossa:", removedText);
          sendResponse({ status: "success", removed: removedText });
        });
      } else {
        console.log("[BackgroundScript] Nessuna copia da rimuovere.");
        sendResponse({ status: "not_found" });
      }
    });
    return true; // Necessario per la risposta asincrona
  } else if (request.type === "findAndReplace") {
    const originalText = request.originalText;
    console.log(
      "[BackgroundScript] Received findAndReplace request for:",
      originalText
    );
    chrome.storage.local.get(["copiedTexts"], (result) => {
      const texts = result.copiedTexts || [];
      const foundEntry = texts.find(
        (entry) => entry.Testo_originale === originalText
      );

      if (foundEntry) {
        console.log(
          "[BackgroundScript] Found translation:",
          foundEntry.Testo_tradotto
        );
        sendResponse({
          status: "found",
          translatedText: foundEntry.Testo_tradotto,
        });
      } else {
        console.log("[BackgroundScript] Translation not found.");
        sendResponse({ status: "not_found" });
      }
    });
    return true; // Necessario per la risposta asincrona
  } else if (request.type === "findUrlTranslation") {
    const originalUrl = request.url;
    console.log(
      "[BackgroundScript] Received findUrlTranslation request for:",
      originalUrl
    );
    if (!urlTranslations || urlTranslations.length === 0) {
      console.warn(
        "[BackgroundScript] urlTranslations non caricate o vuote."
      );
      // Prova a ricaricarle se sono vuote, potrebbe essere un problema di timing all'avvio
      loadUrlTranslations().then(() => {
        const found = urlTranslations.find(
          (entry) => entry.Originale === originalUrl
        );
        if (found) {
          console.log(
            "[BackgroundScript] Found URL translation (after reload):",
            found.Tradotto
          );
          sendResponse({ status: "found", translatedUrl: found.Tradotto });
        } else {
          console.log(
            "[BackgroundScript] URL translation not found (after reload)."
          );
          sendResponse({ status: "not_found" });
        }
      });
      return true; // Risposta asincrona
    }

    const foundEntry = urlTranslations.find(
      (entry) => entry.Originale === originalUrl
    );

    if (foundEntry) {
      console.log(
        "[BackgroundScript] Found URL translation:",
        foundEntry.Tradotto
      );
      sendResponse({ status: "found", translatedUrl: foundEntry.Tradotto });
    } else {
      console.log("[BackgroundScript] URL translation not found.");
      sendResponse({ status: "not_found" });
    }
    return true; // Necessario per la risposta asincrona
  } else if (request.type === "requestOpenAITranslations") {
    // Utilizziamo una funzione asincrona auto-invocante (IIFE)
    // per gestire la logica asincrona e assicurare che sendResponse sia chiamata.
    (async () => {
      try {
        // 1. Assicura che le keywords siano caricate (CRITICHE per il prompt)
        if (!keywords || keywords.length === 0) {
          console.log("[BackgroundScript] Keywords non caricate o vuote. Tentativo di caricamento per richiesta OpenAI...");
          await loadKeywords(); // Attendi il caricamento
          if (!keywords || keywords.length === 0) {
            console.error("[BackgroundScript] CRITICO: Impossibile caricare le keywords. Annullamento richiesta OpenAI.");
            sendResponse({ status: "error", error: "Errore critico: Impossibile caricare le keywords necessarie per il prompt." });
            return; // Esce dalla funzione asincrona IIFE
          }
          console.log("[BackgroundScript] Keywords caricate con successo per la richiesta OpenAI.");
        }

        // 2. Assicura che le traduzioni URL siano caricate (buona prassi, anche se non usate direttamente nel prompt OpenAI)
        if (!urlTranslations || urlTranslations.length === 0) {
          console.log("[BackgroundScript] Traduzioni URL non caricate o vuote. Tentativo di caricamento...");
          await loadUrlTranslations(); // Attendi il caricamento
          if (!urlTranslations || urlTranslations.length === 0) {
            console.warn("[BackgroundScript] Attenzione: Impossibile caricare le traduzioni URL. La richiesta OpenAI procederà comunque se le keywords sono presenti.");
            // Non blocchiamo la chiamata OpenAI se solo le traduzioni URL mancano,
            // dato che il prompt attuale non sembra usarle direttamente, ma le keywords sono essenziali.
          } else {
            console.log("[BackgroundScript] Traduzioni URL caricate con successo.");
          }
        }

        // La logica originale per requestOpenAITranslations inizia qui
        const textsForAPI = request.texts; // Array di {ID, Testo_originale}
        const apiKey =
          "API-KEY-OPENAI"; // ATTENZIONE: Chiave API esposta!

        if (!textsForAPI || textsForAPI.length === 0) {
          sendResponse({
            status: "error",
            error: "Nessun testo fornito per la traduzione.",
          });
          return; // Esce dalla funzione asincrona IIFE
        }

const prompt = `
# Role and Objective
You are tasked with translating website content from English to Norwegian for B2B Lighting Company, a company specialized in lighting solutions. You must ensure accuracy, SEO optimization and preserve codes, URLs and technical content.

# Instructions
Traduci con precisione in norvegese tutti i contenuti testuali (“Testo_originale”), seguendo le regole dettagliate di seguito.

## Sub-categories for more detailed instructions
- **Identificazione del contenuto traducibile**  
  - Traduci testo normale, titoli, sottotitoli, descrizioni.  
  - In frammenti misti (codice + testo), estrai e traduci soltanto la parte testuale, mantenendo intatta la struttura.  
  - Do not translate: "B2B Lighting Company" and product names in uppercase (e.g. FIRENZE EVO, FALKO, NOOS, Dragon solar).

- **Lunghezza e formattazione**  
  - Mantieni una lunghezza simile al testo originale.  
  - Rispetta esattamente la formattazione e il markup presenti.

- **Ottimizzazione SEO**  
  - Inserisci la *focus keyphrase* norvegese in: Title, H1, Primo_paragrafo, Meta_description.  
  - Utilizza la parola chiave principale e suoi sinonimi almeno 3 volte.  
  - Title: 50–70 caratteri (spazi inclusi).  
  - Meta_description: 120–156 caratteri (spazi inclusi).  
  - Incorpora keyword norvegesi ad alto volume quando appropriato; mantieni densità ottimale; usa parole di transizione; evita di iniziare più di 3 frasi consecutive con la stessa parola.

- **Preservazione di elementi tecnici**  
  - Non modificare URL, percorsi di file, tag HTML, attributi, placeholder (es. %%sitename%%), array serializzati, codice o ID tecnici.  
  - Mantieni inalterati codici e link (traduci il testo del link ma non l’URL).

# Reasoning Steps
1. Carica e analizza le keywords fornite.  
2. Carica i testi da tradurre.  
3. Identifica i blocchi di testo traducibili e quelli da preservare.  
4. Traduce ogni blocco secondo le regole di SEO e formattazione.  
5. Verifica la lunghezza e l’inserimento della focus keyphrase.  
6. Compila l’output JSON richiesto.

# Output Format
Rispondi con un array JSON di oggetti:
\[
  \{
    "ID": "Numero_ID",
    "Testo_tradotto": "Traduzione norvegese"
  \},
  ...
\]

# Examples
## Example 1
**Input**  
\{
  "ID": "123",
  "Testo_originale": "Welcome to our site"
\}

**Output**  
\[
  \{
    "ID": "123",
    "Testo_tradotto": "Velkommen til vårt nettsted"
  \}
\]

# Context
**Keywords SEO:** ${JSON.stringify(keywords)}  
**Testi da tradurre:** ${JSON.stringify(textsForAPI)}

# Final instructions and prompt to think step by step
Prima di procedere, pensa passo per passo:
1. Quali keyword usare in ciascuna sezione.  
2. Quali parti del testo tradurre e quali conservare.  
3. Come inserire correttamente la focus keyphrase.  
4. Come mantenere lunghezza e formattazione.  
5. Come strutturare l’output JSON finale.
`;



        console.log(
          "[BackgroundScript] Richiesta traduzioni OpenAI per:",
          textsForAPI
        );

        const requestBody = {
          model: "o4-mini-2025-04-16",
          messages: [
            {
              role: "system",
              content:
                "Sei un assistente di traduzione, TRADUCI DA QUALUNQUE LINGUA AL Norvegese, rispondi solo con JSON strutturato secondo lo schema fornito.",
            },
            { role: "user", content: prompt },
          ]
        };

        console.log(
          "[BackgroundScript] Corpo della richiesta API:",
          JSON.stringify(requestBody, null, 2)
        ); // Log del corpo della richiesta

        fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
          })
            .then(async (response) => {
              const rawText = await response.clone().text();
              console.log("[BackgroundScript] *** RAW OpenAI response ***\n", rawText);
              if (!response.ok) {
                  throw new Error(`API Error: ${response.status} ${response.statusText} - ${rawText}`);
              }
              return response.json();
            })
            .then((apiResponse) => {
            if (
              apiResponse.choices &&
              apiResponse.choices.length > 0 &&
              apiResponse.choices[0].message
            ) {
              console.log(
                "[BackgroundScript] Risposta completa da OpenAI:",
                apiResponse.choices[0].message.content
              );
              const rawContent = apiResponse.choices[0].message.content;
              const translatedData = safeParseTranslations(rawContent);

              if (!translatedData || translatedData.length === 0) {
                console.log(
                  "[BackgroundScript] Nessuna traduzione riconosciuta nel formato ricevuto."
                );
                sendResponse({
                  status: "error",
                  error:
                    "Formato di risposta inatteso: impossibile estrarre traduzioni.",
                });
                return;
              }

              chrome.storage.local.get(["copiedTexts"], (result) => {
                let allTexts = result.copiedTexts || [];
                let updatedCount = 0;

                translatedData.forEach((translatedEntry) => {
                  const index = allTexts.findIndex(
                    (text) => text.ID === translatedEntry.ID
                  );
                  if (index !== -1 && translatedEntry.Testo_tradotto) {
                    allTexts[index].Testo_tradotto =
                      translatedEntry.Testo_tradotto;
                    updatedCount++;
                  }
                });

                if (updatedCount > 0) {
                  chrome.storage.local.set({ copiedTexts: allTexts }, () => {
                    console.log(
                      `[BackgroundScript] ${updatedCount} testi aggiornati con traduzioni.`
                    );
                    sendResponse({
                      status: "success",
                      message: `${updatedCount} traduzioni elaborate.`,
                    });
                  });
                } else {
                  console.log(
                    "[BackgroundScript] Nessuna traduzione valida trovata nei dati ricevuti o nessun testo corrispondente da aggiornare."
                  );
                  sendResponse({
                    status: "success",
                    message: "Nessuna traduzione applicabile trovata.",
                  });
                }
              });
            } else {
              console.error(
                "[BackgroundScript] Risposta API da OpenAI non valida o vuota:",
                apiResponse
              );
              sendResponse({
                status: "error",
                error: "Risposta API da OpenAI non valida o vuota.",
              });
            }
          })
          .catch((error) => {
            console.error(
              "[BackgroundScript] Errore nella richiesta fetch a OpenAI:",
              error
            );
            sendResponse({
              status: "error",
              error: `Errore di rete o API: ${error.message}`,
            });
          });
      } catch (e) {
        // Catch per errori imprevisti all'interno della IIFE prima della chiamata fetch
        console.error("[BackgroundScript] Errore imprevisto durante la preparazione della richiesta OpenAI:", e);
        sendResponse({ status: "error", error: "Errore interno del background script: " + e.message });
      }
    })(); // Fine della IIFE asincrona

    return true; // Mantenere per la risposta asincrona del listener principale
  }
});
