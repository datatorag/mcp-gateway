# What analytics sends

DataToRAG uses PostHog for product analytics, session recordings and error
tracking. This page says what leaves the browser and the server, and what is
kept out. It describes the code; the settings live in
`apps/gateway/src/components/posthog-provider.tsx`,
`apps/gateway/src/lib/analytics-masking.ts`,
`apps/gateway/src/lib/analytics-exceptions.ts` and
`apps/gateway/src/lib/request-error-report.ts`. If those change, this page
changes with them.

Analytics is off outside production unless explicitly allowed
(`docs/architecture/2026-09-09-scrum-228-analytics-off-outside-production-design.md`).

## The rule

Text on a page is hidden from analytics unless it sits inside an element we
marked as ours to show (`data-ph-unmask`). A region that holds account data
is marked hidden (`data-ph-mask`), and the nearer mark wins.

- The public site (home, pricing, docs, blog, skills, sign-in) is marked
  shown at its root. It holds no account data.
- The dashboard is marked hidden at its root, and while a dashboard page is
  open so is the page body, which covers dialogs and menus drawn outside
  the dashboard's own root. Its navigation rail, mobile header, the agent's
  greeting and step labels, the New chat button, the approval buttons, the
  connect buttons and their note, and the name and status of each tool step
  are marked shown. Other TEXT in the dashboard is hidden: messages, tool
  arguments and results, conversation titles, file and calendar names,
  account addresses, and the user's own name and email in the menu.
- An element with the class `ph-no-capture` is left out of recordings
  entirely, and a click on it sends nothing about it.

**Attribute values are a separate case.** The recorder copies an element's
attributes (its tooltip, accessible label, alt text, placeholder, link and
image addresses) as they are, and has no way to mask them. The rule above
covers text, not attributes. So in the dashboard, an element that puts
account data into an attribute carries `ph-no-capture` and is left out
whole: the connected-account tooltip, the user menu button and picture,
each conversation's delete button, and the invoice PDF link. Chat messages
are left out whole too, which covers the links to files an answer can
contain. One exception: a table or code block opened full screen from a
message is drawn outside the message, where its text is hidden but a
`title` attribute written into it would be recorded. A test lists every dynamic `title`, `aria-label`, `alt`,
`placeholder`, `href` and `src` in the dashboard and the shared components,
across lines, and fails on one that has not been classified. Other
attributes are not checked by it. Links that remain are to our own pages,
with opaque conversation ids or skill names in some of them.

## Session recordings

- Every input is masked, whatever it contains.
- Every text node is passed through the rule above. Hidden text is replaced
  character for character with asterisks, so a recording shows where text
  was and how long it was, never what it said.
- Request and response bodies and headers are not recorded: capture is off
  in the client, which the SDK honours over the project setting, and every
  captured request is stripped of them again. Request and page addresses
  are recorded without their query string.
- Console lines are recorded when the project setting enables it, and are
  not filtered. Our code mostly logs statuses, but an error boundary logs
  the error it caught, and an error message can quote what was being
  drawn.

## Click events

Clicks, rage clicks, dead clicks (a click that changes nothing) and dead
swipes are captured. Each event says which page it happened on and the
structure of the element clicked: its tag, classes, id, role, type and test
id, and the same for its ancestors.

When the element clicked is not inside chrome marked as shown, the event
carries no text from the page: the element's text, every ancestor's text,
and every other attribute (titles, labels, link addresses, alt text) are
removed from the list of elements, and the SDK's one-line summary of that
list is rebuilt from what is left, with tag, classes and position only.
When the SDK sends the summary without the list, the summary is dropped. A
click on marked chrome is sent as the SDK builds it, with its label.

Whether a click was on marked chrome is read only from the event's list of
elements, where a mark can only come from a real attribute. When the SDK
sends only its one-line summary of the elements, the click is treated as
hidden, because page text in that summary could imitate a mark.

## Errors

- **In the browser**, uncaught errors and unhandled rejections are sent, and
  errors our own error boundaries catch. Console errors are not captured on
  their own. Each message has anything after `params:` removed (where a
  database driver puts the values of a failed query) and is cut to 300
  characters. The opaque "Script error." that a browser reports for another
  site's script is dropped.
- **On the server**, a failed page render or route is sent with the error's
  name, the same trimmed message, its stack, the framework's error id, the
  route as a pattern (`/dashboard/billing`, never the address with its
  query), the kind of render and the HTTP method. No user, no headers, no
  cookies. At most ten reports per route per minute.

## Identity

Signed-in users are identified to PostHog by account id, email and name, so
events and recordings can be tied to the person they belong to. Visitors who
have not signed in are anonymous.
