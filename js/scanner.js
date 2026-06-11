const Scanner = (() => {
  let html5QrCode = null;

  async function start(onSuccess) {
    if (!html5QrCode) {
      html5QrCode = new Html5Qrcode("reader");
    }

    const config = {
      fps: 10,
      qrbox: { width: 250, height: 150 },
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

  return { start, stop };
})();
