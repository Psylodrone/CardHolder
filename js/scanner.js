const Scanner = (() => {
  let html5QrCode = null;

  // The camera (html5-qrcode) and photo-decode (ZXing) libraries are big
  // (~650KB together) and only needed for scanning — NOT for viewing cards.
  // Load them on demand so the app launches without waiting on them.
  let libsPromise = null;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });
  }
  function ensureLibs() {
    if (!libsPromise) {
      libsPromise = Promise.all([
        typeof Html5Qrcode !== "undefined"
          ? null
          : loadScript("https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"),
        typeof ZXing !== "undefined"
          ? null
          : loadScript("https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js"),
      ]).catch((e) => {
        libsPromise = null; // allow a retry next time
        throw e;
      });
    }
    return libsPromise;
  }

  async function start(onSuccess) {
    await ensureLibs();
    if (!html5QrCode) {
      html5QrCode = new Html5Qrcode("reader");
    }

    const config = {
      fps: 10,
      // Wide scan box so long 1D barcodes aren't cropped
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const width = Math.floor(viewfinderWidth * 0.9);
        const height = Math.floor(Math.min(viewfinderHeight * 0.5, width * 0.5));
        return { width, height };
      },
      // Square viewfinder instead of full portrait camera frame
      aspectRatio: 1.0,
      // 2x zoom (where iOS allows it) magnifies small barcodes at full
      // sensor resolution, so they can be scanned from focusable distance
      defaultZoomValueIfSupported: 2,
      videoConstraints: {
        facingMode: "environment",
        width: { ideal: 2560 },
        height: { ideal: 1440 },
      },
      // Use the platform's native barcode detector when the browser has one
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true,
      },
    };

    return html5QrCode.start(
      { facingMode: "environment" },
      config,
      (decodedText, decodedResult) => {
        const formatName =
          decodedResult?.result?.format?.formatName || "UNKNOWN";
        onSuccess(decodedText, formatName);
      },
      () => {
        // ignore per-frame "no code found" errors
      }
    );
  }

  async function stop() {
    if (!html5QrCode) return;
    try {
      const state = html5QrCode.getState();
      if (
        state === Html5QrcodeScannerState.SCANNING ||
        state === Html5QrcodeScannerState.PAUSED
      ) {
        await html5QrCode.stop();
      }
      html5QrCode.clear();
    } catch (e) {
      console.warn("Scanner stop error", e);
    }
  }

  // Maps native BarcodeDetector format names to our internal names
  const NATIVE_FORMATS = {
    ean_13: "EAN_13",
    ean_8: "EAN_8",
    upc_a: "UPC_A",
    upc_e: "UPC_E",
    code_128: "CODE_128",
    code_39: "CODE_39",
    codabar: "CODABAR",
    itf: "ITF",
    qr_code: "QR_CODE",
    data_matrix: "DATA_MATRIX",
    pdf417: "PDF_417",
    aztec: "AZTEC",
  };

  // Decode a still photo at full camera resolution. html5-qrcode's own
  // scanFile downscales the image to the viewfinder size, destroying
  // small barcodes — so we use the native detector or ZXing instead.
  async function scanFile(file) {
    await ensureLibs();
    await stop();

    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();

      // 1. Native platform detector (same engine as native apps)
      if ("BarcodeDetector" in window) {
        try {
          const detector = new BarcodeDetector();
          const codes = await detector.detect(img);
          if (codes.length > 0) {
            return {
              text: codes[0].rawValue,
              format: NATIVE_FORMATS[codes[0].format] || "UNKNOWN",
            };
          }
        } catch (e) {
          console.warn("Native BarcodeDetector failed, trying ZXing", e);
        }
      }

      // 2. ZXing at full image resolution with TRY_HARDER
      const hints = new Map();
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      const reader = new ZXing.BrowserMultiFormatReader(hints);
      const result = await reader.decodeFromImageElement(img);
      return {
        text: result.getText(),
        format: ZXing.BarcodeFormat[result.getBarcodeFormat()] || "UNKNOWN",
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return { start, stop, scanFile, preload: ensureLibs };
})();
