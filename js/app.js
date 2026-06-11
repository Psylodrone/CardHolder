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
// apple-touch-icon (180x180 by convention), then favicon service
function logoCandidates(domain) {
  return [
    "https://" + domain + "/apple-touch-icon.png",
    "https://icons.duckduckgo.com/ip3/" + encodeURIComponent(domain) + ".ico",
  ];
}

function colorFor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return "hsl(" + h + ", 55%, 45%)";
}

function makeThumb(card) {
  const wrap = document.createElement("div");
  wrap.className = "card-thumb";

  const showAvatar = () => {
    wrap.innerHTML = "";
    const av = document.createElement("div");
    av.className = "card-avatar";
    av.style.background = colorFor(card.name);
    av.textContent = (card.name.trim()[0] || "?").toUpperCase();
    wrap.appendChild(av);
  };

  const domain = card.domain || guessDomain(card.name);
  if (domain) {
    const candidates = logoCandidates(domain);
    let attempt = 0;
    const img = document.createElement("img");
    img.className = "card-logo";
    img.alt = "";
    img.onerror = () => {
      attempt += 1;
      if (attempt < candidates.length) {
        img.src = candidates[attempt];
      } else {
        showAvatar();
      }
    };
    img.src = candidates[0];
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
    cardDomainInput.value = "";
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
  cardDomainInput.value = "";
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
      cardDomainInput.value = "";
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
  const domain = normalizeDomain(cardDomainInput.value) || null;

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
