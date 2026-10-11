// A short burst of confetti in the chart colors. Skipped for anyone who asks
// their phone for less motion; the words that come with it still show.

const COLORS = ["--protein", "--carbs", "--fat", "--weight", "--accent"];

export function confetti(pieces = 70) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const layer = document.createElement("div");
  layer.className = "confetti";
  layer.setAttribute("aria-hidden", "true");
  for (let i = 0; i < pieces; i++) {
    const piece = document.createElement("i");
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = `var(${COLORS[i % COLORS.length]})`;
    piece.style.animationDelay = `${Math.random() * 0.5}s`;
    piece.style.animationDuration = `${1.8 + Math.random() * 1.2}s`;
    piece.style.setProperty("--drift", `${Math.round((Math.random() - 0.5) * 160)}px`);
    piece.style.setProperty("--spin", `${Math.round(Math.random() * 900 - 450)}deg`);
    layer.append(piece);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 3800);
}
