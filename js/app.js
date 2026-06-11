const STORAGE_KEY = "cardholder.cards";

const FORMAT_MAP = {
  EAN_13: "EAN13",
  EAN_8: "EAN8",
  UPC_A: "UPC",
  UPC_E: "UPCE",
  CODE_128: "CODE128",
  CODE_39: "CODE39",
  CODABAR: "codabar",
  ITF: "ITF14",
};

const views = ["view-home", "view-scan", "view-detail"];
const headerTitle = document.getElementById("header-title");
const backBtn = document.getElementById("back-btn");
const addBtn = document.getElementById("add-btn");
const readerEl = document.getElementById("reader");
const scanResultEl = document.getElementById("scan-result");
const cardNameInput = document.getElementById("card-name-input");
const cardCodeInput = document.getElementById("card-code-input");
const manualBtn = document.getElementById("manual-btn");

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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
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
    li.innerHTML = `
      <div>
        <div class="card-name">${escapeHtml(card.name)}</div>
        <div class="card-format">${escapeHtml(card.format)}</div>
      </div>
      <div>&rsaquo;</div>
    `;
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
  manualBtn.hidden = false;
  readerEl.hidden = false;
  readerEl.innerHTML = "";
  Scanner.start((decodedText, formatName) => {
    Scanner.stop();
    cardCodeInput.value = decodedText;
    scanResultEl.dataset.format = formatName;
    cardNameInput.value = "";
    scanResultEl.hidden = false;
    cardNameInput.focus();
  }).catch((err) => {
    alert("Camera error: " + err);
  });
}

function startManualEntry() {
  Scanner.stop();
  readerEl.hidden = true;
  manualBtn.hidden = true;
  scanResultEl.dataset.format = "CODE_128";
  cardNameInput.value = "";
  cardCodeInput.value = "";
  scanResultEl.hidden = false;
  cardNameInput.focus();
}

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
  const format = scanResultEl.dataset.format;
  const name = cardNameInput.value.trim() || "Untitled card";

  const cards = loadCards();
  cards.push({ id: makeId(), name, code, format });
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
      .register("service-worker.js")
      .catch((err) => console.warn("SW registration failed", err));
  });
}
