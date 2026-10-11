// Voice input (SPEC section 7): the browser's Web Speech API. Works in Chrome
// and Safari, including iPhone (as webkitSpeechRecognition). Where it doesn't
// exist, the mic button is hidden and the text box does the same job.

/** The slice of the Web Speech API we use; TypeScript's DOM types don't ship it. */
interface Recognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function voiceSupported() {
  return ctor() !== null;
}

/** Plain words for each way listening can fail. null means "say nothing" (the user stopped it). */
export function voiceErrorMessage(code: string): string | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "The microphone is turned off for this site. You can type instead, or allow the microphone in your browser settings.";
    case "no-speech":
      return "Didn't catch that. Tap the mic and try again.";
    case "audio-capture":
      return "No microphone found. You can type instead.";
    case "network":
      return "Voice needs an internet connection. You can type instead.";
    case "aborted":
      return null;
    default:
      return "Voice didn't work that time. Tap the mic to try again, or type instead.";
  }
}

export interface Listening {
  stop(): void;
}

/**
 * Listen for one phrase. `onWords` gets the transcript so far as it grows
 * (interim results), `onDone` the final transcript (possibly empty), and
 * `onError` a code from voiceErrorMessage. Exactly one of onDone / onError
 * ends a session, then `onEnd` always runs.
 */
export function listen(handlers: {
  onWords: (text: string) => void;
  onDone: (text: string) => void;
  onError: (code: string) => void;
  onEnd: () => void;
}): Listening | null {
  const Ctor = ctor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  let finalText = "";
  let latest = "";
  let failed = false;

  rec.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    latest = `${finalText}${interim}`.replace(/\s+/g, " ").trim();
    handlers.onWords(latest);
  };
  rec.onerror = (event) => {
    failed = true;
    handlers.onError(event.error);
  };
  rec.onend = () => {
    // Some browsers end without marking the last words final; use what was heard.
    if (!failed) handlers.onDone((finalText || latest).replace(/\s+/g, " ").trim());
    handlers.onEnd();
  };

  try {
    rec.start();
  } catch {
    handlers.onError("start-failed");
    handlers.onEnd();
    return null;
  }
  return { stop: () => rec.stop() };
}
