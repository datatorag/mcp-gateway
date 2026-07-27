import { staticFile } from "remotion";

/**
 * Remotion does not serve the public dir at the URL root — assets resolve
 * through staticFile(). Product components hardcode root-absolute paths
 * ("/icons/services/gmail.svg", "/datatorag-logo-256.png") because that is
 * correct in the app. Rather than fork the components (the whole point is
 * not to), rewrite root-absolute <img> sources through staticFile() as they
 * enter the DOM. setPublicDir points at the gateway's real public dir, so
 * the rewritten URL serves the real asset.
 */
export function installAssetShim() {
  if (typeof document === "undefined") return;

  // staticFile() URLs are themselves root-absolute (e.g. "/public/…") —
  // derive the prefix at runtime so already-rewritten sources are skipped
  // instead of double-rewritten.
  const staticPrefix = staticFile("x").replace(/x$/, "");

  const rewrite = (img: HTMLImageElement) => {
    const src = img.getAttribute("src");
    if (!src || !src.startsWith("/") || src.startsWith(staticPrefix)) return;
    if (img.dataset.captureShimmed) return;
    img.dataset.captureShimmed = "1";
    img.src = staticFile(src.slice(1));
  };

  const sweep = (root: ParentNode) => {
    if (root instanceof HTMLImageElement) rewrite(root);
    root.querySelectorAll?.("img").forEach(rewrite);
  };

  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "attributes" && m.target instanceof HTMLImageElement) {
        // A React re-render can restore the original src; re-shim it.
        if (!m.target.getAttribute("src")?.startsWith("/")) continue;
        delete m.target.dataset.captureShimmed;
        rewrite(m.target);
      }
      m.addedNodes.forEach((n) => {
        if (n instanceof Element) sweep(n);
      });
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });

  sweep(document);
}
