export class Utilities {

  /* -----------------------------
   * TEXT
   * ----------------------------- */

  static clampText(str, maxChars = 3500, suffix = "\n\n[...clipped for length...]") {
    const s = String(str ?? "").trim();
    if (s.length <= maxChars) return s;
    return s.slice(0, maxChars) + suffix;
  }

  static wrapText(str, maxCharsPerLine) {
    const s = String(str || "").trim();
    if (!s) return [];
    if (s.length <= maxCharsPerLine) return [s];

    // Simple word-wrap without measuring pixels (good enough for short labels)
    const words = s.split(/\s+/g);
    const lines = [];
    let line = "";

    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (next.length <= maxCharsPerLine) {
        line = next;
      } else {
        if (line) lines.push(line);
        // If a single word is too long, hard-split
        if (w.length > maxCharsPerLine) {
          lines.push(w.slice(0, maxCharsPerLine));
          line = w.slice(maxCharsPerLine);
        } else {
          line = w;
        }
      }
    }
    if (line) lines.push(line);

    // Clamp to 3 lines for aesthetics; last line ellipsis
    if (lines.length > 3) {
      const kept = lines.slice(0, 3);
      kept[2] = kept[2].replace(/\s+$/g, "");
      if (!kept[2].endsWith("…")) kept[2] = kept[2].slice(0, Math.max(0, kept[2].length - 1)) + "…";
      return kept;
    }

    return lines;
  }

  static escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  static normalizeWhitespace(str) {
    return String(str ?? "").replace(/\s+/g, " ").trim();
  }

  static isEmpty(str) {
    return !String(str ?? "").trim();
  }

  static setMultilineText(textEl, lines, lineHeight = 13, opts = {}) {
    while (textEl.firstChild) textEl.removeChild(textEl.firstChild);

    const x = textEl.getAttribute("x");
    const total = lines.length || 1;
    const startOffset = -((total - 1) * lineHeight) / 2;

    lines.forEach((line, i) => {
      const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      tspan.setAttribute("x", x);
      tspan.setAttribute("dy", i === 0 ? startOffset : lineHeight);
      tspan.textContent = line ?? "";

      if (opts.boldLast && i === lines.length - 1) {
        tspan.setAttribute("font-weight", "800");
      }

      textEl.appendChild(tspan);
    });
  }



  /* -----------------------------
   * URLs / MEDIA
   * ----------------------------- */

  static formatVideoUrl(url) {
    const u = String(url ?? "").trim();
    if (!u) return "";

    // YouTube watch → embed
    if (u.includes("youtube.com/watch")) {
      try {
        const id = new URL(u).searchParams.get("v");
        return id ? `https://www.youtube.com/embed/${id}` : u;
      } catch {
        return u;
      }
    }

    // youtu.be → embed
    if (u.includes("youtu.be/")) {
      const id = u.split("youtu.be/")[1]?.split("?")[0];
      return id ? `https://www.youtube.com/embed/${id}` : u;
    }

    // Vimeo → embed
    if (u.includes("vimeo.com/")) {
      const id = u.split("vimeo.com/")[1]?.split("?")[0];
      return id ? `https://player.vimeo.com/video/${id}` : u;
    }

    return u;
  }

  static isPdfUrl(url) {
    return /\.pdf(\?|$)/i.test(String(url ?? ""));
  }

  /* -----------------------------
   * NUMBERS / SCORING
   * ----------------------------- */

  static clampNumber(num, min, max) {
    const n = Number(num);
    if (!Number.isFinite(n)) return null;
    return Math.max(min, Math.min(max, n));
  }

  static scoreClass(score) {
    if (score === null || score === undefined) return "sc-score-na";
    if (score >= 75) return "sc-score-good";
    if (score >= 50) return "sc-score-mid";
    return "sc-score-low";
  }

  /* -----------------------------
   * ARRAYS / OBJECTS
   * ----------------------------- */

  static safeArray(val) {
    return Array.isArray(val) ? val : [];
  }

  static tryParseJson(val) {
    if (typeof val === "object" && val !== null) return val;
    if (typeof val !== "string") return null;
    try { return JSON.parse(val); } catch { return null; }
  }
}
