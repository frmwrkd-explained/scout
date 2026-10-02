# Native Paperclip board verification — 2026-10-02

Scout: `http://127.0.0.1:5190/`. Actual installed native Paperclip:
`paperclipai@2026.1001.0`, `http://127.0.0.1:5191/SCO/issues`.
Company: Scout bridge demo — synthetic work only.

- Scout's primary Paperclip board entry loaded Paperclip's actual company task UI in a frame.
- The native Board view was selected and persisted after Reload board, Back to Scout and
  Admin → Open board. The native sidebar replaces Scout's rail in this screen.
- The native board showed four existing issues: three synthetic proof tasks in Todo and
  SCO-4, Prepare the local onboarding comparison experiment (Paperclip), In Progress.
- Open Paperclip opened the same company in a separate native-app tab. From there, clicking
  SCO-4 showed its actual approved brief and the earlier GPT-6 Luna draft comment. Clicking
  Agents showed the callback worker and the earlier execution-disabled worker.
- The browser automation runtime could inspect/render the frame but could not dispatch
  clicks into it (`Click target is no longer available`). Native task/agent navigation was
  therefore verified in the full app tab. Dragging statuses was not tested or simulated.
- Six new connection tests cover prefix resolution, token isolation, local access with the
  worker bridge off, absent configuration, foreign/injected routes, remote errors and stale
  workspace/connection responses. The full Scout suite passed: 1,032 tests. Build passed,
  with the existing bundle-size warning.
- No issue status, worker run, goal count or model budget was changed for this UI proof.
  The board shows delegated Paperclip work; the five Scout team agents remain in Admin.

Screenshot: [Scout with the native board](paperclip-board.png).
Callback credential masking/rotation is recorded separately in the header-redaction proof.
