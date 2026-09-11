# tools/list says who asked (SCRUM-256)

Date: 2026-09-11

## Problem

The `mcp_tools_listed` event carried one number, the length of the list
served. That number cannot answer the questions a "my client shows no
tools" thread asks: which client listed, over which protocol revision,
and whether a short list means the user has nothing connected or the
client never got past the handshake. The tool-call event already names
the client; the listing that precedes every call did not.

## Change

- The event carries the count split in two, `connector_tools` (the rows
  the connected-service policy left for this user) and `builtin_tools`
  (the gateway's own registry, the same length for everyone), with
  `tool_count` kept as their sum so existing insights keep reading.
- It carries `client_name` and `client_version` from the initialize
  handshake, read from the SDK server the same way the tool-call event
  reads the name.
- It carries `protocol_version`, the revision the client asked for. The
  SDK negotiates that at initialize and keeps no getter for it, so the
  HTTP layer reads it off the initialize body, beside the client info it
  already extracts for the request-received event, and hands it to the
  server as an option. The in-process agent client passes none, and the
  field is null there.
- Absent values are null, not undefined, so a filter on the property
  finds the rows where the client said nothing.

## What stays out

No tool name, no schema, no request body. The event describes the asker
and the size of the answer, nothing in the answer.

## Verification

- `mcp-analytics.test.ts`: the extractor reads the protocol version
  beside clientInfo, ignores a non-string, caps a long one; the tracker
  writes the split, the sum, the identity, and null for what is absent;
  the property key set is pinned so a tool name cannot slip in.
- `mcp-server.listed.test.ts`: through a real client and server pair,
  the handler reports the split from the rows it served, the client name
  and version the handshake carried, the protocol version the server was
  given, and zero connector tools for a user with nothing connected.
