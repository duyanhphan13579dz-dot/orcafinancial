/** Pause polling when tab is hidden to save bandwidth & upstream quota. */
export function whenVisible(fn: () => void): () => void {
  if (typeof document === "undefined") {
    fn();
    return () => undefined;
  }
  const run = () => {
    if (document.visibilityState === "visible") fn();
  };
  document.addEventListener("visibilitychange", run);
  return () => document.removeEventListener("visibilitychange", run);
}

export function isDocumentVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}
