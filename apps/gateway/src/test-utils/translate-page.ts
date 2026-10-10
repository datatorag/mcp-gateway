/**
 * What a browser's page translation does to a document, for tests.
 *
 * Every text node with words in it is removed and a `<font>` element pair
 * holding the translated text is put in its place. The original node is left
 * detached, which is the whole problem for a renderer that still holds it:
 * the node it wants to remove, or insert in front of, is no longer a child
 * of the parent it remembers.
 *
 * Returns how many nodes were replaced, so a caller can assert the page was
 * translated at all before asserting anything about what happened next.
 */
export function translatePage(rootNode: Node, mark = "[t] "): number {
  const doc = rootNode.ownerDocument ?? document;
  const walker = doc.createTreeWalker(rootNode, 4 /* NodeFilter.SHOW_TEXT */);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent) continue;
    // Already translated, or not prose.
    if (parent.tagName === "FONT" || parent.closest("script,style,textarea,code,pre")) continue;
    if ((node.nodeValue ?? "").trim() === "") continue;
    texts.push(node as Text);
  }
  for (const text of texts) {
    const outer = doc.createElement("font");
    const inner = doc.createElement("font");
    inner.textContent = `${mark}${text.nodeValue ?? ""}`;
    outer.appendChild(inner);
    text.parentNode?.replaceChild(outer, text);
  }
  return texts.length;
}
