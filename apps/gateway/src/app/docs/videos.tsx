"use client";

import { useEffect } from "react";

/**
 * Turns a docs page's video link into its player when it is clicked.
 *
 * `lib/docs-media.ts` writes each video embed as a link drawn as the video's
 * poster, so a page view does not load the player. A plain click on one is
 * taken here and the link is replaced by the player, playing, in the same
 * box. A modified click (new tab, new window) is left alone and opens the
 * video itself, which is also what the link does with no script.
 *
 * One listener on the document, because the page's HTML is injected as a
 * string and has no components to hang handlers on. Mounted once by the docs
 * layout.
 */
/** The only player address a link may turn into. The page writes it from a
 * checked video id; this holds the same shape at the moment of use, so an
 * attribute that came from anywhere else never becomes a frame. */
const PLAYER_URL = /^https:\/\/www\.youtube(-nocookie)?\.com\/embed\/[A-Za-z0-9_-]{6,20}(\?[A-Za-z0-9_=&-]*)?$/;

export function DocsVideos() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>("a[data-video-embed]");
      const embed = link?.dataset.videoEmbed;
      if (!link || !embed || !PLAYER_URL.test(embed)) return;
      event.preventDefault();

      const player = document.createElement("iframe");
      player.src = embed;
      player.title = link.dataset.videoTitle ?? "Video";
      if (link.dataset.videoAllow) player.setAttribute("allow", link.dataset.videoAllow);
      player.setAttribute("allowfullscreen", "");
      player.style.cssText = "width:100%;aspect-ratio:16/9;border:0;border-radius:12px;";
      link.replaceWith(player);
      player.focus();
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return null;
}
