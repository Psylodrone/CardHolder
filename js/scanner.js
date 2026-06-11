const Scanner = (() => {
  let html5QrCode = null;

  async function start(onSuccess) {
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

  // Decode a still photo (full camera resolution, much more reliable
  // than video frames for small barcodes)
  async function scanFile(file) {
    await stop();
    if (!html5QrCode) {
      html5QrCode = new Html5Qrcode("reader");
    }
    if (typeof html5QrCode.scanFileV2 === "function") {
      const res = await html5QrCode.scanFileV2(file, false);
      return {
        text: res.decodedText,
        format: res.result?.format?.formatName || "UNKNOWN",
      };
    }
    const text = await html5QrCode.scanFile(file, false);
    return { text, format: "UNKNOWN" };
  }

  return { start, stop, scanFile };
})();
