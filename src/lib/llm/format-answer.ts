/**
 * Soft-clean agent text: strip noisy markdown so UI reads like chat prose.
 * Does not invent content — only normalizes formatting.
 */
export function smoothAgentAnswer(raw: string): string {
  if (!raw) return raw;

  let text = raw.replace(/\r\n/g, "\n").trim();

  // Remove ATX headings → keep the title text as a plain sentence lead
  text = text.replace(/^#{1,6}\s+/gm, "");

  // Horizontal rules
  text = text.replace(/^\s*([-*_]){3,}\s*$/gm, "");

  // Bullet / numbered lists → plain lines (drop marker only)
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+[.)]\s+/gm, "");

  // Collapse excessive bold/italic markers while keeping inner words
  // **foo** or __foo__ → foo (keep one pair if short emphasis is rare — strip all for smoothness)
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/(?<![*\w])\*([^*]+)\*(?![*\w])/g, "$1");

  // Inline code backticks
  text = text.replace(/`([^`]+)`/g, "$1");

  // Italic underscore leftovers _foo_
  text = text.replace(/(?<![\w])_([^_]+)_(?![\w])/g, "$1");

  // Compress 3+ blank lines → 2; then trim each line's trailing space
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}
