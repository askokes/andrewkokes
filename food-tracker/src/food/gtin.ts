// Product barcodes (UPC and EAN, together "GTINs"). Pure functions, shared by
// the Worker and the scanner screen.

/** Ids for Open Food Facts products in usda_cache: this plus the GTIN as a number (see barcode.ts). */
export const OFF_ID_MIN = 1_000_000_000_000_000;
export const isOffId = (id: number) => id >= OFF_ID_MIN;

/** GTIN lengths: EAN-8, UPC-A, EAN-13 and GTIN-14. */
const LENGTHS = new Set([8, 12, 13, 14]);

/** The last digit checks the others: weights 3 and 1, alternating from the right. */
function checkDigitOk(code: string): boolean {
  let sum = 0;
  for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) sum += Number(code[i]) * weight;
  return (10 - (sum % 10)) % 10 === Number(code[code.length - 1]);
}

/** A barcode as typed or scanned ("0 16000 27528 7"), as digits, or null if it can't be a real one. */
export function readBarcode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(code) || !LENGTHS.has(code.length) || !checkDigitOk(code)) return null;
  // All zeros passes the check digit but is never a product.
  return /^0+$/.test(code) ? null : code;
}

/** The same product's code at every length is the same digits after the leading zeros. */
export const barcodeKey = (code: string) => code.replace(/^0+/, "");

/**
 * The forms a product may be filed under, the given one first: a UPC-A
 * ("016000275287") is also its EAN-13 with a leading zero ("0016000275287").
 */
export function barcodeForms(code: string): string[] {
  const key = barcodeKey(code);
  const forms = [code];
  for (const length of [12, 13]) if (key.length <= length) forms.push(key.padStart(length, "0"));
  return [...new Set(forms)];
}

/**
 * A UPC-E (the short code on small packages, "04252614") as its UPC-A
 * ("042100005264"), which is how databases file it. null if it isn't one.
 */
export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const [system, d1, d2, d3, d4, d5, d6, check] = code;
  let body: string;
  if (d6 <= "2") body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === "3") body = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === "4") body = `${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  const upcA = `${system}${body}${check}`;
  return checkDigitOk(upcA) ? upcA : null;
}

/**
 * The product code in what a scanner read, or null if it isn't one. `format`
 * is the BarcodeDetector format. Newer packages carry a QR code with a GS1
 * Digital Link ("https://id.gs1.org/01/00016000275287") or a GS1 element
 * string ("(01)00016000275287..."); other QR codes are just links.
 */
export function productCode(raw: string, format: string): string | null {
  const value = raw.trim();
  if (format === "upc_e") return expandUpcE(value) ?? readBarcode(value);
  if (format === "qr_code" || format === "data_matrix") {
    const link = /^https?:\/\/[^/?#]+(?:\/[^?#]*)?\/01\/(\d{8,14})(?:[/?#]|$)/i.exec(value);
    if (link) return readBarcode(link[1]);
    // Element strings: "(01)" with brackets, or bare "01" after the scanner's FNC1 (sent as a group separator).
    const element = /^(?:\(01\)|\u001d?01)(\d{14})/.exec(value);
    return element ? readBarcode(element[1]) : null;
  }
  return readBarcode(value);
}
