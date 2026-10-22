import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import {
  MessageList,
  type PlaygroundMessage,
} from "@/app/dashboard/playground-presentation";
import { AGENT_COVER } from "../lib/formats";
import { SETTLED, cueProgress, enterStyle } from "../lib/cue";

/**
 * Blog cover for the Notion launch post: an Agent thread in which the
 * assistant finds a Notion page and reads it.
 *
 * The transcript is the dashboard Agent's real `MessageList`, given the same
 * props `playground.tsx` passes it on the Agent page (body text `sm`, closed
 * tool cards summarising their arguments). Nothing is restated.
 *
 * The two tool calls are REAL: arguments and results recorded live through
 * the production gateway on 2026-10-22 against the runner's fixture page,
 * copied here verbatim. The `account` argument is a workspace name, not a
 * person. Results go in the envelope every plugin tool returns
 * (`jsonResponse`: `{content: [{type: "text", text: <JSON, 2-space>}]}`).
 */

function envelope(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

const PAGE_ID = "400b91cc-091d-8181-b4aa-c52d62754858";
const PAGE_TITLE = "DataToRAG runner fixture page kestrel-7f3a";

const SEARCH_INPUT = {
  query: "kestrel-7f3a",
  object: "page",
  page_size: 5,
  account: "DataToRAG Workspace",
};

/** First of the five results the live call returned (has_more was true).
 * Only the first was recorded, so only the first is carried. The card that
 * holds it renders closed, as the Agent shows a finished call. */
const SEARCH_FIRST_RESULT = {
  id: PAGE_ID,
  object: "page",
  title: PAGE_TITLE,
  url: "https://app.notion.com/p/DataToRAG-runner-fixture-page-kestrel-7f3a-400b91cc091d8181b4aac52d62754858",
  parent: { type: "page", id: "400b91cc-091d-81f2-8003-d763ac6c3406" },
  last_edited_time: "2026-10-22T06:51:00.000Z",
};

const GET_PAGE_INPUT = { page_id: PAGE_ID, account: "DataToRAG Workspace" };

const GET_PAGE_RESULT = {
  id: PAGE_ID,
  title: PAGE_TITLE,
  properties: { title: PAGE_TITLE },
  markdown:
    "This page is read by the production test runner. It has a title, this body text, no mentions and no child pages at the start of a run. The runner duplicates it and creates stamped children under it, then trashes them.\nA second paragraph so the markdown read has more than one block.",
  truncated: false,
  unknown_block_ids: [],
};

const MESSAGES: PlaygroundMessage[] = [
  {
    id: "cover-u-0",
    role: "user",
    parts: [
      {
        type: "text",
        text: "Find the kestrel-7f3a fixture page in Notion and tell me what it says.",
      },
    ],
  },
  {
    id: "cover-a-1",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolName: "notion-mcp__notion_search",
        toolCallId: "cover-call-search",
        state: "output-available",
        input: SEARCH_INPUT,
        output: envelope({ results: [SEARCH_FIRST_RESULT], has_more: true }),
      },
      {
        type: "dynamic-tool",
        toolName: "notion-mcp__notion_get_page",
        toolCallId: "cover-call-get-page",
        state: "output-available",
        input: GET_PAGE_INPUT,
        output: envelope(GET_PAGE_RESULT),
      },
      {
        type: "text",
        text: "The page is the test runner's fixture. It holds a title and two paragraphs: the runner reads it, duplicates it, creates stamped children under it and trashes them afterwards.",
      },
    ],
  },
];

const EMPTY: Record<string, never> = {};
const NONE: ReadonlySet<string> = new Set();
const noop = () => {};

export function NotionAgentCoverShot({ cue = SETTLED }: { cue?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const spec = AGENT_COVER;
  const p = cueProgress({ frame, fps, cue });

  return (
    <AbsoluteFill className="bg-background">
      {/* Offset by `pad`, not centred: zoom multiplies `left`, see
          docs-demo.tsx. AbsoluteFill only as the stage background. */}
      <div
        className="capture-wrap-code"
        style={{
          position: "absolute",
          top: spec.pad,
          left: spec.pad,
          zoom: spec.zoom,
          width: spec.authorWidth,
          ...enterStyle(p),
        }}
      >
        <MessageList
          awaitingConfirm={false}
          busy={false}
          comments={EMPTY}
          erroredIds={NONE}
          feedback={EMPTY}
          lastMessageComplete
          messages={MESSAGES}
          onCommentChange={noop}
          onDecide={noop}
          onRate={noop}
          onRegenerate={noop}
          onSendComment={noop}
          summarizeTools
          textSize="sm"
        />
      </div>
    </AbsoluteFill>
  );
}
