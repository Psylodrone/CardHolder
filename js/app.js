const STORAGE_KEY = "cardholder.cards";

const FORMAT_MAP = {
  EAN_13: "EAN13",
  EAN_8: "EAN8",
  UPC_A: "UPC",
  UPC_E: "UPCE",
  CODE_128: "CODE128",
  CODE_39: "CODE39",
  CODABAR: "codabar",
  ITF: "ITF",
};

// Guess a likely format from the code so the picker starts on a sane default
function guessFormat(code) {
  if (/^\d{13}$/.test(code)) return "EAN_13";
  if (/^\d{12}$/.test(code)) return "UPC_A";
  if (/^\d{8}$/.test(code)) return "EAN_8";
  return "CODE_128";
}

const views = ["view-home", "view-scan", "view-detail"];
const headerTitle = document.getElementById("header-title");
const backBtn = document.getElementById("back-btn");
const addBtn = document.getElementById("add-btn");
const readerEl = document.getElementById("reader");
const scanResultEl = document.getElementById("scan-result");
const cardNameInput = document.getElementById("card-name-input");
const cardDomainInput = document.getElementById("card-domain-input");
const domainDropdown = document.getElementById("domain-dropdown");
const cardCodeInput = document.getElementById("card-code-input");
const manualBtn = document.getElementById("manual-btn");
const formatField = document.getElementById("format-field");
const formatSelect = document.getElementById("card-format-select");
const photoBtn = document.getElementById("photo-btn");
const photoInput = document.getElementById("photo-input");
const previewField = document.getElementById("preview-field");
const previewEl = document.getElementById("manual-preview");

let selectedCardId = null;

function loadCards() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCards(cards) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
}

function makeId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function normalizeDomain(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}

// Guess a domain from the first word of the card name, e.g.
// "Tesco Clubcard" -> "tesco.com"; returns null for non-latin names
function guessDomain(name) {
  const first = (name.trim().split(/\s+/)[0] || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  return first.length >= 3 ? first + ".com" : null;
}

// Logo sources in order of quality: the site's own high-res
// apple-touch-icon (180x180 by convention), then Google's favicon service.
// Google returns a 16x16 generic globe when a site has no icon, which we
// detect by size (see loadBestLogo) and reject in favor of a letter avatar.
function logoCandidates(domain) {
  return [
    "https://" + domain + "/apple-touch-icon.png",
    "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(domain) + "&sz=128",
  ];
}

// Load the first candidate that yields a real logo. Rejects images that
// fail to decode and the tiny placeholder globes (<=16px). Calls onFail
// when nothing usable remains.
function loadBestLogo(img, candidates, onFail) {
  let i = 0;
  const next = () => {
    i += 1;
    if (i < candidates.length) img.src = candidates[i];
    else onFail();
  };
  img.onerror = next;
  img.onload = () => {
    if (img.naturalWidth && img.naturalWidth <= 16) next();
  };
  img.src = candidates[0];
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

// Stable fallback brand color derived from the name
function fallbackColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return hslToRgb(h, 0.55, 0.45);
}

function rgbStr(c) {
  return "rgb(" + c.r + "," + c.g + "," + c.b + ")";
}

// Pick black or white text for readability against a background color
function textColorFor(c) {
  const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  return lum > 0.6 ? "#1c1c1e" : "#ffffff";
}

// Best-effort: read a logo's dominant color. Only works when the image
// host sends CORS headers; otherwise the canvas is tainted and we return
// null so the caller keeps the stable fallback color.
function extractLogoColor(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha < 200) continue; // skip transparent areas
          const cr = data[i], cg = data[i + 1], cb = data[i + 2];
          // skip near-white and near-black pixels (usually background)
          const max = Math.max(cr, cg, cb), min = Math.min(cr, cg, cb);
          if (max > 240 && min > 240) continue;
          if (max < 25) continue;
          r += cr; g += cg; b += cb; n++;
        }
        if (n === 0) return resolve(null);
        resolve({ r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) });
      } catch (e) {
        resolve(null); // tainted canvas
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Persist a computed color on the card so it's not recomputed each load
function persistCardColor(id, color) {
  const cards = loadCards();
  const card = cards.find((c) => c.id === id);
  if (card) {
    card.bg = color;
    saveCards(cards);
  }
}

function makeThumb(card) {
  const wrap = document.createElement("div");
  wrap.className = "card-thumb";

  const showAvatar = () => {
    wrap.innerHTML = "";
    const av = document.createElement("div");
    av.className = "card-avatar";
    av.style.background = rgbStr(card.bg || fallbackColor(card.name));
    av.textContent = (card.name.trim()[0] || "?").toUpperCase();
    wrap.appendChild(av);
  };

  const domain = card.domain || guessDomain(card.name);
  if (domain) {
    const img = document.createElement("img");
    img.className = "card-logo";
    img.alt = "";
    loadBestLogo(img, logoCandidates(domain), showAvatar);
    wrap.appendChild(img);
  } else {
    showAvatar();
  }
  return wrap;
}

function showView(id, title) {
  views.forEach((v) =>
    document.getElementById(v).classList.toggle("active", v === id)
  );
  headerTitle.textContent = title;
  backBtn.hidden = id === "view-home";
  addBtn.hidden = id !== "view-home";

  if (id !== "view-scan") {
    Scanner.stop();
    scanResultEl.hidden = true;
  }
}

function renderCardList() {
  const cards = loadCards();
  const list = document.getElementById("card-list");
  const empty = document.getElementById("empty-state");
  list.innerHTML = "";

  if (cards.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  cards.forEach((card) => {
    const li = document.createElement("li");
    li.className = "card-item";

    li.appendChild(makeThumb(card));

    const nameEl = document.createElement("div");
    nameEl.className = "card-name";
    nameEl.textContent = card.name;
    li.appendChild(nameEl);

    // Colored strip below the logo, with text that adapts for contrast
    const applyColor = (color) => {
      nameEl.style.background = rgbStr(color);
      nameEl.style.color = textColorFor(color);
    };
    applyColor(card.bg || fallbackColor(card.name));

    // If we haven't already cached a color, try to derive it from the logo
    const domain = card.domain || guessDomain(card.name);
    if (!card.bg && domain) {
      extractLogoColor(logoCandidates(domain)[0]).then((color) => {
        if (color) {
          applyColor(color);
          persistCardColor(card.id, color);
        }
      });
    }

    li.addEventListener("click", () => openDetail(card.id));
    list.appendChild(li);
  });
}

function mapFormat(format) {
  return FORMAT_MAP[format] || "CODE128";
}

function renderBarcode(container, code, format) {
  container.innerHTML = "";

  if (format === "QR_CODE") {
    const canvas = document.createElement("canvas");
    container.appendChild(canvas);
    QRCode.toCanvas(canvas, code, { width: 220 }, (err) => {
      if (err) console.error(err);
    });
    return;
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  container.appendChild(svg);
  try {
    JsBarcode(svg, code, {
      format: mapFormat(format),
      displayValue: false,
      margin: 10,
    });
  } catch (e) {
    console.warn("Barcode render fallback to CODE128", e);
    JsBarcode(svg, code, { format: "CODE128", displayValue: false, margin: 10 });
  }
}

function startScan() {
  scanResultEl.hidden = true;
  formatField.hidden = true;
  manualBtn.hidden = false;
  photoBtn.hidden = false;
  readerEl.hidden = false;
  readerEl.innerHTML = "";
  Scanner.start((decodedText, formatName) => {
    Scanner.stop();
    cardCodeInput.value = decodedText;
    scanResultEl.dataset.format = formatName;
    cardNameInput.value = "";
    resetDomainField();
    scanResultEl.hidden = false;
    updatePreview();
    cardNameInput.focus();
  }).catch((err) => {
    alert("Camera error: " + err);
  });
}

function startManualEntry() {
  Scanner.stop();
  readerEl.hidden = true;
  manualBtn.hidden = true;
  photoBtn.hidden = true;
  cardNameInput.value = "";
  resetDomainField();
  cardCodeInput.value = "";
  formatSelect.value = "CODE_128";
  formatField.hidden = false;
  scanResultEl.hidden = false;
  updatePreview();
  cardNameInput.focus();
}

function currentFormat() {
  return formatField.hidden ? scanResultEl.dataset.format : formatSelect.value;
}

function updatePreview() {
  const code = cardCodeInput.value.trim();
  if (!code) {
    previewField.hidden = true;
    return;
  }
  previewField.hidden = false;
  const format = currentFormat();

  if (format === "QR_CODE") {
    renderBarcode(previewEl, code, format);
    return;
  }

  previewEl.innerHTML = "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  previewEl.appendChild(svg);
  try {
    JsBarcode(svg, code, {
      format: mapFormat(format),
      displayValue: false,
      margin: 10,
    });
  } catch (e) {
    previewEl.innerHTML =
      '<p class="preview-error">This code isn\'t valid for the selected barcode type</p>';
  }
}

cardCodeInput.addEventListener("input", () => {
  if (!formatField.hidden) {
    formatSelect.value = guessFormat(cardCodeInput.value.trim());
  }
  updatePreview();
});

formatSelect.addEventListener("change", updatePreview);

// --- Company search dropdown ---

let domainManualMode = false;
let domainDebounce = null;
let domainFetchCtrl = null;

function hideDomainDropdown() {
  domainDropdown.hidden = true;
  domainDropdown.innerHTML = "";
}

function resetDomainField() {
  cardDomainInput.value = "";
  cardDomainInput.placeholder = "Search company…";
  domainManualMode = false;
  hideDomainDropdown();
}

function renderDomainDropdown(matches) {
  domainDropdown.innerHTML = "";

  matches.slice(0, 5).forEach((m) => {
    const item = document.createElement("div");
    item.className = "dropdown-item";

    const img = document.createElement("img");
    img.alt = "";
    loadBestLogo(img, logoCandidates(m.domain), () => img.remove());
    item.appendChild(img);

    const text = document.createElement("div");
    const nameEl = document.createElement("div");
    nameEl.className = "dd-name";
    nameEl.textContent = m.name;
    const domainEl = document.createElement("div");
    domainEl.className = "dd-domain";
    domainEl.textContent = m.domain;
    text.appendChild(nameEl);
    text.appendChild(domainEl);
    item.appendChild(text);

    // pointerdown fires before the input's blur, so the tap registers
    item.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      cardDomainInput.value = m.domain;
      hideDomainDropdown();
    });
    domainDropdown.appendChild(item);
  });

  const manual = document.createElement("div");
  manual.className = "dropdown-item dropdown-manual";
  manual.textContent = "Type domain manually…";
  manual.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    domainManualMode = true;
    cardDomainInput.value = "";
    cardDomainInput.placeholder = "e.g. tesco.com";
    hideDomainDropdown();
    cardDomainInput.focus();
  });
  domainDropdown.appendChild(manual);

  domainDropdown.hidden = false;
}

function hasCyrillic(s) {
  return /[Ѐ-ӿ]/.test(s);
}

// Source 1: Clearbit — strong for Western brands
async function searchClearbit(q, signal) {
  try {
    const res = await fetch(
      "https://autocomplete.clearbit.com/v1/companies/suggest?query=" + encodeURIComponent(q),
      { signal }
    );
    const arr = await res.json();
    return arr.map((c) => ({ name: c.name, domain: c.domain }));
  } catch (e) {
    return [];
  }
}

// Source 2: Wikidata — multilingual (incl. Ukrainian), resolves a brand
// to its official website (property P856)
async function searchWikidata(q, signal) {
  try {
    const lang = hasCyrillic(q) ? "uk" : "en";
    const sres = await fetch(
      "https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*" +
        "&limit=7&language=" + lang + "&uselang=" + lang +
        "&search=" + encodeURIComponent(q),
      { signal }
    );
    const hits = (await sres.json()).search || [];
    if (!hits.length) return [];

    const ids = hits.map((h) => h.id).join("|");
    const eres = await fetch(
      "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*" +
        "&props=claims&ids=" + ids,
      { signal }
    );
    const entities = (await eres.json()).entities || {};

    const out = [];
    for (const h of hits) {
      const claims = entities[h.id] && entities[h.id].claims && entities[h.id].claims.P856;
      if (!claims || !claims.length) continue;
      let url;
      try {
        url = claims[0].mainsnak.datavalue.value;
      } catch (e) {
        continue;
      }
      const domain = normalizeDomain(url);
      if (domain && domain.includes(".")) {
        out.push({ name: h.label || (h.match && h.match.text) || q, domain });
      }
    }
    return out;
  } catch (e) {
    return [];
  }
}

// Run both sources in parallel, merge and dedupe by domain
async function fetchCompanySuggestions(q, signal) {
  const [clearbit, wikidata] = await Promise.all([
    searchClearbit(q, signal),
    searchWikidata(q, signal),
  ]);
  const seen = new Set();
  const merged = [];
  for (const item of [...clearbit, ...wikidata]) {
    if (!item.domain) continue;
    const key = item.domain.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

cardDomainInput.addEventListener("input", () => {
  const q = cardDomainInput.value.trim();
  if (q === "") domainManualMode = false;
  if (domainManualMode || q.length < 2) {
    hideDomainDropdown();
    return;
  }
  clearTimeout(domainDebounce);
  domainDebounce = setTimeout(async () => {
    try {
      if (domainFetchCtrl) domainFetchCtrl.abort();
      domainFetchCtrl = new AbortController();
      const matches = await fetchCompanySuggestions(q, domainFetchCtrl.signal);
      if (matches.length) renderDomainDropdown(matches);
      else hideDomainDropdown();
    } catch (e) {
      // aborted or offline — just leave the dropdown closed
    }
  }, 300);
});

cardDomainInput.addEventListener("blur", () => setTimeout(hideDomainDropdown, 150));

photoBtn.addEventListener("click", () => photoInput.click());

photoInput.addEventListener("change", () => {
  const file = photoInput.files[0];
  photoInput.value = "";
  if (!file) return;

  Scanner.scanFile(file)
    .then(({ text, format }) => {
      readerEl.hidden = true;
      manualBtn.hidden = true;
      photoBtn.hidden = true;
      cardCodeInput.value = text;
      cardNameInput.value = "";
      resetDomainField();
      if (format === "UNKNOWN") {
        formatSelect.value = guessFormat(text);
        formatField.hidden = false;
      } else {
        scanResultEl.dataset.format = format;
        formatField.hidden = true;
      }
      scanResultEl.hidden = false;
      updatePreview();
      cardNameInput.focus();
    })
    .catch(() => {
      alert("No barcode found in that photo. Try getting closer or improving lighting.");
      startScan();
    });
});

function openDetail(id) {
  const cards = loadCards();
  const card = cards.find((c) => c.id === id);
  if (!card) return;
  selectedCardId = id;

  document.getElementById("detail-name").textContent = card.name;
  document.getElementById("detail-value").textContent = card.code;
  renderBarcode(document.getElementById("detail-barcode"), card.code, card.format);

  showView("view-detail", card.name);
}

addBtn.addEventListener("click", () => {
  showView("view-scan", "Scan card");
  startScan();
});

backBtn.addEventListener("click", () => {
  showView("view-home", "CardHolder");
  renderCardList();
});

document.getElementById("rescan-btn").addEventListener("click", startScan);

manualBtn.addEventListener("click", startManualEntry);

document.getElementById("save-card-btn").addEventListener("click", () => {
  const code = cardCodeInput.value.trim();
  if (!code) {
    alert("Card code can't be empty.");
    return;
  }
  const format = formatField.hidden ? scanResultEl.dataset.format : formatSelect.value;
  const name = cardNameInput.value.trim() || "Untitled card";
  // Only treat the field as a domain if it actually looks like one (has a
  // dot). Free-text left over from searching falls back to the name guess.
  const typed = normalizeDomain(cardDomainInput.value);
  const domain = typed.includes(".") ? typed : null;

  const cards = loadCards();
  cards.push({ id: makeId(), name, code, format, domain });
  saveCards(cards);

  showView("view-home", "CardHolder");
  renderCardList();
});

document.getElementById("delete-card-btn").addEventListener("click", () => {
  if (!selectedCardId) return;
  if (!confirm("Delete this card?")) return;

  let cards = loadCards();
  cards = cards.filter((c) => c.id !== selectedCardId);
  saveCards(cards);
  selectedCardId = null;

  showView("view-home", "CardHolder");
  renderCardList();
});

renderCardList();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("service-worker.js", { updateViaCache: "none" })
      .then((reg) => reg.update())
      .catch((err) => console.warn("SW registration failed", err));
  });
}
