import { expandUpcE, productCode, readBarcode } from "../../../src/food/gtin";
import { el, icon } from "../dom";
import { overlayClosed, pushOverlay } from "../nav";

/** Store barcodes, plus QR codes for the GS1 links newer packages carry. */
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "qr_code"] as const;
/** Time between reads of the picture. Each read takes a few milliseconds. */
const SCAN_EVERY_MS = 120;

interface Detected {
  rawValue: string;
  format: string;
}
interface Detector {
  detect(source: HTMLVideoElement): Promise<Detected[]>;
}
interface DetectorClass {
  new (opts: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

let detector: Promise<Detector> | null = null;

/**
 * The phone's own barcode reader where there is one (Chrome on Android), else
 * ZXing compiled to WebAssembly (iPhone), loaded the first time the scanner opens.
 */
function getDetector(): Promise<Detector> {
  detector ??= (async () => {
    const Native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
    if (Native) {
      try {
        const supported = await Native.getSupportedFormats();
        if (["ean_13", "upc_a"].every((f) => supported.includes(f))) return new Native({ formats: FORMATS.filter((f) => supported.includes(f)) });
      } catch {
        // Fall back to ZXing.
      }
    }
    const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
      import("barcode-detector/ponyfill"),
      import("zxing-wasm/reader/zxing_reader.wasm?url"),
    ]);
    // The reader comes from this app, not a CDN.
    prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) } });
    return new BarcodeDetector({ formats: [...FORMATS] }) as unknown as Detector;
  })();
  // A failed load (offline) is tried again next time.
  detector.catch(() => (detector = null));
  return detector;
}

/** A typed barcode: the digits under the lines, any length a package uses. */
function typedCode(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return readBarcode(digits) ?? expandUpcE(digits);
}

/**
 * Opens the camera full screen and reads the first product barcode it sees,
 * or one typed in. `onCode` gets its digits once the scanner is closed and its
 * history entry gone. Closing it any other way (X, Escape, back) does nothing.
 */
export function openScanner(onCode: (code: string) => void) {
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let found: string | null = null;

  const video = el("video", { className: "scan-video", muted: true, autoplay: true, playsInline: true, attrs: { playsinline: "", "aria-hidden": "true" } });
  const view = el("div", { className: "scan-view" }, video, el("div", { className: "scan-frame", attrs: { "aria-hidden": "true" } }));
  const status = el("p", { className: "scan-status", attrs: { role: "status" }, textContent: "Starting the camera…" });
  const close = el("button", { type: "button", className: "icon-button scan-close", attrs: { "aria-label": "Close the scanner" } }, icon("close"));

  const input = el("input", {
    id: "barcode-number",
    type: "text",
    className: "control",
    placeholder: "0 12345 67890 5",
    attrs: { inputmode: "numeric", autocomplete: "off", enterkeyhint: "search", "aria-describedby": "barcode-msg" },
  });
  const msg = el("p", { id: "barcode-msg", className: "form-msg", attrs: { "aria-live": "polite" } });
  const typeForm = el(
    "form",
    { className: "scan-type", hidden: true, noValidate: true },
    el("label", { htmlFor: "barcode-number", className: "add-label", textContent: "Barcode number" }),
    el("p", { className: "hint", textContent: "The digits under the lines, all of them." }),
    el("div", { className: "input-row" }, input, el("button", { type: "submit", className: "button", textContent: "Look up" })),
    msg,
  );
  const typeIt = el("button", { type: "button", className: "button secondary wide", textContent: "Type the number instead" });

  const dialog = el(
    "dialog",
    { className: "scanner", attrs: { "aria-label": "Scan a barcode" } },
    el("div", { className: "scan-top" }, el("h2", { textContent: "Scan a barcode" }), close),
    view,
    status,
    typeIt,
    typeForm,
  );

  function stopCamera() {
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
  }

  /** No camera: say why, and go straight to typing. */
  function typeInstead(reason?: string) {
    stopCamera();
    view.hidden = true;
    typeIt.hidden = true;
    status.textContent = reason ?? "";
    status.hidden = !reason;
    typeForm.hidden = false;
    input.focus();
  }

  function got(code: string) {
    found = code;
    navigator.vibrate?.(60);
    dialog.close();
  }

  async function scanLoop(reader: Detector) {
    if (!dialog.open || !stream) return;
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      try {
        for (const d of await reader.detect(video)) {
          const code = productCode(d.rawValue, d.format);
          if (code) return got(code);
          if (d.format === "qr_code") status.textContent = "That QR code is a link, not the product. Try the barcode, the one with lines.";
        }
      } catch {
        // A frame it couldn't read; try the next one.
      }
    }
    timer = setTimeout(() => scanLoop(reader), SCAN_EVERY_MS);
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) return typeInstead("This browser can't use the camera here.");
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (err) {
      const blocked = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      return typeInstead(
        blocked
          ? "The camera is turned off for this app. You can turn it on in your browser's settings for this site, or type the number."
          : "We couldn't start the camera.",
      );
    }
    // Closed while the phone was asking for the camera.
    if (!dialog.open) return stopCamera();
    video.srcObject = stream;
    await video.play().catch(() => {});
    let reader: Detector;
    try {
      reader = await getDetector();
    } catch {
      return typeInstead("The scanner didn't load. Check your connection, or type the number.");
    }
    if (!dialog.open) return;
    status.textContent = "Hold the barcode inside the box.";
    scanLoop(reader);
  }

  close.addEventListener("click", () => dialog.close());
  typeIt.addEventListener("click", () => typeInstead());
  input.addEventListener("input", () => (msg.textContent = ""));
  typeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = typedCode(input.value);
    if (code) got(code);
    else msg.textContent = input.value.trim() ? "That number doesn't look right. Check the digits and try again." : "Type the digits under the lines first.";
  });

  document.body.append(dialog);
  dialog.showModal();
  const overlay = pushOverlay(() => dialog.close());
  dialog.addEventListener("close", async () => {
    stopCamera();
    dialog.remove();
    await overlayClosed(overlay);
    if (found) onCode(found);
  });
  startCamera();
}
