/**
 * What analytics may read off the page (SCRUM-414).
 *
 * ONE RULE, FOR RECORDINGS AND FOR CLICK EVENTS ALIKE: text is hidden unless
 * it sits inside an element we have marked as ours to show. The page's own
 * chrome (navigation, headings, button labels we wrote) is marked with
 * `data-ph-unmask`. A region that holds account data is marked
 * `data-ph-mask`, and the nearer of the two marks decides. The public site
 * is marked as shown at its root; the dashboard is marked as hidden at its
 * root, and its chrome is marked as shown inside that.
 *
 * Hidden-by-default is the point. A new component that renders somebody's
 * email, file name or calendar entry is hidden from the moment it ships,
 * whether or not its author thought about analytics. The cost of a mistake
 * goes the other way round: an unmarked label shows as asterisks in a
 * recording, which somebody notices and marks.
 *
 * `ph-no-capture` keeps its separate, stronger meaning: the element is left
 * out of recordings entirely and a click on it sends nothing.
 *
 * WHAT THIS DOES NOT COVER: ATTRIBUTE VALUES IN RECORDINGS. The recorder
 * copies every attribute (title, aria-label, alt, placeholder, href, src) as
 * it is, and the SDK has no hook to mask them. So an element that puts
 * account data into an attribute must carry `ph-no-capture`, which leaves
 * the whole element out. `analytics-masking.test.ts` lists every dynamic
 * title, aria-label, alt, placeholder, href and src in the dashboard and the
 * shared components, across lines, and fails on one nobody has classified.
 */

export const UNMASK_ATTR = "data-ph-unmask";
export const MASK_ATTR = "data-ph-mask";

/** Spread onto an element to show its text to analytics. */
export const UNMASK = { [UNMASK_ATTR]: "" } as const;
/** Spread onto an element to hide everything inside it, even under chrome. */
export const MASK = { [MASK_ATTR]: "" } as const;

/** Whether text in or under this element may be shown: the nearest marked
 * ancestor (or the element itself) decides, and no mark means hidden. */
export function isRevealed(element: Element | null | undefined): boolean {
  const marked = element?.closest?.(`[${UNMASK_ATTR}],[${MASK_ATTR}]`);
  return Boolean(marked && marked.hasAttribute(UNMASK_ATTR));
}

/** The recorder's text hook. Called for every text node, because the mask
 * selector below matches every element. Hidden text keeps its shape (the
 * recording still shows where text was and how long it was) and loses its
 * characters. */
export function maskRecordedText(text: string, element?: HTMLElement | null): string {
  return isRevealed(element) ? text : text.replace(/\S/g, "*");
}

/** An address without its query string or fragment: a path says which page
 * or endpoint, a query can say anything. */
export function withoutQuery(url: unknown): string {
  if (typeof url !== "string") return "";
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** The recorder's network hook, for requests a recording captures and for
 * the page addresses it notes. Bodies and headers are always removed, as a
 * second line behind `recordBody`/`recordHeaders` being off below: a request
 * the recorder captures for timing still passes through here. */
export function maskRecordedNetworkRequest<T extends { name?: string }>(request: T): T {
  return {
    ...request,
    name: withoutQuery(request.name),
    requestHeaders: undefined,
    requestBody: undefined,
    responseHeaders: undefined,
    responseBody: undefined,
  };
}

/** The SDK's session recording options. Inputs are masked whatever they
 * contain (a value typed into a field is never chrome); every text node goes
 * through the hook above; every captured request through the one below. */
export const RECORDING_MASKING = {
  maskAllInputs: true,
  maskTextSelector: "*",
  maskTextFn: maskRecordedText,
  maskCapturedNetworkRequestFn: maskRecordedNetworkRequest,
  // Off on the client, which the SDK honours over the project setting.
  recordHeaders: false,
  recordBody: false,
} as const;

/* -------------------------------------------------------------------------- */
/* Click events                                                                */
/* -------------------------------------------------------------------------- */

/** Every event the SDK builds from a clicked element and its ancestors. */
const INTERACTIONS = new Set(["$autocapture", "$rageclick", "$dead_click", "$dead_swipe"]);

/** The attributes of an element that may be sent when its text may not:
 * structure, never content. Anything else, a title, an aria-label, an href
 * with an id in it, an alt text, is removed. */
const SAFE_ATTRS = new Set(["class", "id", "role", "type", "data-testid", "data-slot", UNMASK_ATTR, MASK_ATTR]);

interface ElementProps {
  tag_name?: unknown;
  $el_text?: unknown;
  [key: string]: unknown;
}

interface CapturedEvent {
  event?: string;
  properties?: Record<string, unknown>;
}

/** Whether the clicked element sits under chrome we marked as shown.
 *
 * READ FROM THE ELEMENT LIST ONLY. There, a mark is a KEY, and a key comes
 * from a real attribute name, which page content cannot create. The chain
 * string is one flat text in which an attribute value sits next to the
 * marks, and a title or a line of an email ending in the right characters
 * reads exactly like a mark. So an event that carries only the chain string
 * is treated as hidden, whatever it says. Fails closed throughout: no list,
 * or no mark in it, means hidden. */
export function interactionRevealed(properties: Record<string, unknown>): boolean {
  const elements = properties.$elements;
  if (!Array.isArray(elements)) return false;
  for (const element of elements as ElementProps[]) {
    if (!element || typeof element !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(element, `attr__${UNMASK_ATTR}`)) return true;
    if (Object.prototype.hasOwnProperty.call(element, `attr__${MASK_ATTR}`)) return false;
  }
  return false;
}

/** The keys of one element that may be sent when its text may not. An
 * allow-list: a key a future SDK adds to an element is dropped. */
const SAFE_ELEMENT_KEYS = new Set(["tag_name", "classes", "nth_child", "nth_of_type"]);

function scrubElement(element: ElementProps): ElementProps {
  const kept: ElementProps = {};
  for (const [key, value] of Object.entries(element)) {
    const safe = key.startsWith("attr__") ? SAFE_ATTRS.has(key.slice("attr__".length)) : SAFE_ELEMENT_KEYS.has(key);
    if (safe) kept[key] = value;
  }
  return kept;
}

/** The one-line summary the SDK sends next to the element list, rebuilt
 * from the scrubbed list: tag, classes and position, nothing else. The
 * original string is never parsed or edited on this path. It is a flat text
 * in which values and structure cannot be told apart reliably (the SDK
 * escapes quotes but not backslashes), so anything less than rebuilding it
 * can leave a value behind, a link address included. */
function chainFrom(elements: ElementProps[]): string {
  return elements
    .filter((element) => element && typeof element === "object")
    .map((element) => {
      const tag = typeof element.tag_name === "string" ? element.tag_name.replace(/[^a-z0-9-]/gi, "") : "";
      const classes = Array.isArray(element.classes)
        ? element.classes.filter((c): c is string => typeof c === "string").map((c) => `.${c.replace(/[^\w\-\[\]:/%]/g, "")}`).join("")
        : "";
      const nthChild = typeof element.nth_child === "number" ? `nth-child="${element.nth_child}"` : "";
      const nthOfType = typeof element.nth_of_type === "number" ? `nth-of-type="${element.nth_of_type}"` : "";
      const position = nthChild + nthOfType;
      return `${tag}${classes}${position ? `:${position}` : ""}`;
    })
    .join(";");
}

/**
 * A click event with everything written on the page taken out of it, unless
 * the element clicked is chrome we marked as shown. What remains says where
 * (the page, which the SDK adds itself), what kind of element and its
 * structure, and how it was clicked.
 *
 * Per element this is an allow-list: tag, classes, position and the
 * attributes in SAFE_ATTRS survive, and nothing else, so a key a future SDK
 * adds to an element is dropped. The summary string is rebuilt from that
 * list. TOP-LEVEL PROPERTIES ARE NOT ALLOW-LISTED: the SDK's envelope (page,
 * session, device) is too wide to enumerate. Every top-level key the SDK
 * derives from the element (`$el_*`) is dropped, as is `$external_click_url`
 * (an enclosing link's address). A new top-level content property in a
 * future SDK would pass through, so check one here when the SDK is bumped.
 */
export function beforeSendInteraction<T extends CapturedEvent | null>(event: T): T {
  if (!event || !event.event || !INTERACTIONS.has(event.event) || !event.properties) return event;
  if (interactionRevealed(event.properties)) return event;
  const { $external_click_url: _url, $elements, $elements_chain: _chain, ...rest } = event.properties;
  const properties: Record<string, unknown> = Object.fromEntries(
    Object.entries(rest).filter(([key]) => !key.startsWith("$el_"))
  );
  // With an element list, the list is scrubbed and the summary rebuilt from
  // it. Without one, there is no summary at all.
  if (Array.isArray($elements)) {
    const scrubbed = ($elements as ElementProps[]).map((element) =>
      element && typeof element === "object" ? scrubElement(element) : element
    );
    properties.$elements = scrubbed;
    properties.$elements_chain = chainFrom(scrubbed);
  }
  return { ...event, properties };
}
