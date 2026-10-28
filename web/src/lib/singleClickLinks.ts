// installSingleClickLinks makes a double click on a link open its page
// once. Without it the second click opens the same page again, and the
// back button then seems to do nothing the first time.
export function installSingleClickLinks(target: Document = document): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.detail > 1 && (event.target as Element | null)?.closest?.("a[href]")) {
      event.preventDefault();
    }
  };
  target.addEventListener("click", onClick, true);
  return () => target.removeEventListener("click", onClick, true);
}
