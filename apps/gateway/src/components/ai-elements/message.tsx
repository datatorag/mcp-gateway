"use client";

import { Button } from "@/components/ui/button";
import {
  ButtonGroup,
  ButtonGroupText,
} from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { UIMessage } from "ai";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactElement } from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Streamdown, defaultRehypePlugins } from "streamdown";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      // (`is-user:dark` removed — not a registered Tailwind variant in this
      // config, which defines only `dark`, so it compiled to nothing.)
      "flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({
  className,
  children,
  ...props
}: MessageActionsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size = "icon-sm",
  ...props
}: MessageActionProps) => {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger render={button} />
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
};

interface MessageBranchContextType {
  currentBranch: number;
  totalBranches: number;
  goToPrevious: () => void;
  goToNext: () => void;
  branches: ReactElement[];
  setBranches: (branches: ReactElement[]) => void;
}

const MessageBranchContext = createContext<MessageBranchContextType | null>(
  null
);

const useMessageBranch = () => {
  const context = useContext(MessageBranchContext);

  if (!context) {
    throw new Error(
      "MessageBranch components must be used within MessageBranch"
    );
  }

  return context;
};

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number;
  onBranchChange?: (branchIndex: number) => void;
};

export const MessageBranch = ({
  defaultBranch = 0,
  onBranchChange,
  className,
  ...props
}: MessageBranchProps) => {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch);
  const [branches, setBranches] = useState<ReactElement[]>([]);

  const handleBranchChange = useCallback(
    (newBranch: number) => {
      setCurrentBranch(newBranch);
      onBranchChange?.(newBranch);
    },
    [onBranchChange]
  );

  const goToPrevious = useCallback(() => {
    const newBranch =
      currentBranch > 0 ? currentBranch - 1 : branches.length - 1;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const goToNext = useCallback(() => {
    const newBranch =
      currentBranch < branches.length - 1 ? currentBranch + 1 : 0;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const contextValue = useMemo<MessageBranchContextType>(
    () => ({
      branches,
      currentBranch,
      goToNext,
      goToPrevious,
      setBranches,
      totalBranches: branches.length,
    }),
    [branches, currentBranch, goToNext, goToPrevious]
  );

  return (
    <MessageBranchContext.Provider value={contextValue}>
      <div
        className={cn("grid w-full gap-2 [&>div]:pb-0", className)}
        {...props}
      />
    </MessageBranchContext.Provider>
  );
};

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageBranchContent = ({
  children,
  ...props
}: MessageBranchContentProps) => {
  const { currentBranch, setBranches, branches } = useMessageBranch();
  const childrenArray = useMemo(
    () => (Array.isArray(children) ? children : [children]),
    [children]
  );

  // Use useEffect to update branches when they change
  useEffect(() => {
    if (branches.length !== childrenArray.length) {
      setBranches(childrenArray);
    }
  }, [childrenArray, branches, setBranches]);

  return childrenArray.map((branch, index) => (
    <div
      className={cn(
        "grid gap-2 overflow-hidden [&>div]:pb-0",
        index === currentBranch ? "block" : "hidden"
      )}
      key={branch.key}
      {...props}
    >
      {branch}
    </div>
  ));
};

export type MessageBranchSelectorProps = ComponentProps<typeof ButtonGroup>;

export const MessageBranchSelector = ({
  className,
  ...props
}: MessageBranchSelectorProps) => {
  const { totalBranches } = useMessageBranch();

  // Don't render if there's only one branch
  if (totalBranches <= 1) {
    return null;
  }

  return (
    <ButtonGroup
      className={cn(
        "[&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md",
        className
      )}
      orientation="horizontal"
      {...props}
    />
  );
};

export type MessageBranchPreviousProps = ComponentProps<typeof Button>;

export const MessageBranchPrevious = ({
  children,
  ...props
}: MessageBranchPreviousProps) => {
  const { goToPrevious, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Previous branch"
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronLeftIcon size={14} />}
    </Button>
  );
};

export type MessageBranchNextProps = ComponentProps<typeof Button>;

export const MessageBranchNext = ({
  children,
  ...props
}: MessageBranchNextProps) => {
  const { goToNext, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Next branch"
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronRightIcon size={14} />}
    </Button>
  );
};

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>;

export const MessageBranchPage = ({
  className,
  ...props
}: MessageBranchPageProps) => {
  const { currentBranch, totalBranches } = useMessageBranch();

  return (
    <ButtonGroupText
      className={cn(
        "border-none bg-transparent text-muted-foreground shadow-none",
        className
      )}
      {...props}
    >
      {currentBranch + 1} of {totalBranches}
    </ButtonGroupText>
  );
};

type RehypePlugins = NonNullable<ComponentProps<typeof Streamdown>["rehypePlugins"]>;
type UrlTransform = NonNullable<ComponentProps<typeof Streamdown>["urlTransform"]>;

/** Streamdown 2.5 exposes NEITHER allowlist as a component prop: both live
 * inside `defaultRehypePlugins.harden` (rehype-harden), hard-coded to
 * `allowedImagePrefixes: ["*"], allowedLinkPrefixes: ["*"]` — i.e. wide open.
 * Tightening them means rebuilding the plugin list. */
type HardenOptions = {
  allowedImagePrefixes?: string[];
};

/** Streamdown's own default rehype plugin list with `harden` re-configured.
 * Derived from `defaultRehypePlugins` (rather than a hand-rolled list) so
 * `raw` and `sanitize` — which strip raw HTML — stay exactly as Streamdown
 * ships them, in order. */
function hardenedRehypePlugins(overrides: HardenOptions): RehypePlugins {
  return Object.entries(defaultRehypePlugins).map(([name, plugin]) => {
    if (name !== "harden") {
      return plugin;
    }
    const [hardenPlugin, hardenDefaults] = plugin as unknown as [
      unknown,
      HardenOptions,
    ];
    return [hardenPlugin, { ...hardenDefaults, ...overrides }];
  }) as RehypePlugins;
}

/** Link allowlisting is done with react-markdown's `urlTransform` rather than
 * rehype-harden's `allowedLinkPrefixes`, which cannot express "any https URL":
 * harden matches a prefix by parsing it into a URL and comparing ORIGINS, and
 * it throws outright ("defaultOrigin is required...") if you hand it a
 * non-wildcard prefix without a `defaultOrigin`. Both spellings were tried —
 * `["https://"]` alone throws at render, and `["https://"]` plus a
 * `defaultOrigin` collapses to same-origin-only and blocks every external
 * link, including the verification links the playground's system prompt asks
 * the model to produce. A literal prefix test is what the name actually
 * promises. `""` is react-markdown's own representation of a rejected URL
 * (see its `defaultUrlTransform`). */
function prefixUrlTransform(allowedPrefixes: string[]): UrlTransform {
  return (url: string) =>
    url.startsWith("#") || allowedPrefixes.some((prefix) => url.startsWith(prefix))
      ? url
      : "";
}

export type MessageResponseProps = ComponentProps<typeof Streamdown> & {
  /** URL prefixes an image `src` must start with; `[]` blocks every image.
   * Use `[]` wherever the markdown is model output derived from untrusted
   * content: an image URL is a silent, automatic, browser-issued GET to an
   * arbitrary host, so it is an exfiltration channel that needs no user
   * interaction. Blocked images render as an inline "[Image blocked]" chip. */
  allowedImagePrefixes?: string[];
  /** URL prefixes an anchor `href` must start with (plain string prefix
   * match; in-page `#fragment` links are always kept). Anything else renders
   * with an empty href, so it cannot navigate. */
  allowedLinkPrefixes?: string[];
};

const streamdownPlugins = { cjk, code, math, mermaid };

export const MessageResponse = memo(
  ({
    className,
    allowedImagePrefixes,
    allowedLinkPrefixes,
    rehypePlugins,
    urlTransform,
    ...props
  }: MessageResponseProps) => {
    // Both memos key on the joined VALUES, not the array identities: call
    // sites pass inline literals (static policy), and a fresh identity every
    // render would churn `rehypePlugins`/`urlTransform`, which Streamdown
    // compares by reference when deciding whether to re-render each block.
    const imageKey = allowedImagePrefixes?.join(" ");
    const linkKey = allowedLinkPrefixes?.join(" ");

    // (No stale-closure hazard: each key is derived from the array it guards,
    // so the key changes exactly when the contents do.)
    const hardened = useMemo(
      () =>
        allowedImagePrefixes === undefined
          ? undefined
          : hardenedRehypePlugins({ allowedImagePrefixes }),
      [imageKey] // eslint-disable-line react-hooks/exhaustive-deps
    );
    const linkTransform = useMemo(
      () =>
        allowedLinkPrefixes === undefined
          ? undefined
          : prefixUrlTransform(allowedLinkPrefixes),
      [linkKey] // eslint-disable-line react-hooks/exhaustive-deps
    );

    return (
      <Streamdown
        className={cn(
          "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          className
        )}
        plugins={streamdownPlugins}
        rehypePlugins={rehypePlugins ?? hardened}
        urlTransform={urlTransform ?? linkTransform}
        {...props}
      />
    );
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating
);

MessageResponse.displayName = "MessageResponse";

export type MessageToolbarProps = ComponentProps<"div">;

export const MessageToolbar = ({
  className,
  children,
  ...props
}: MessageToolbarProps) => (
  <div
    className={cn(
      "mt-4 flex w-full items-center justify-between gap-4",
      className
    )}
    {...props}
  >
    {children}
  </div>
);
