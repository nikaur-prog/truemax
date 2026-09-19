import assert from "node:assert/strict";
import test from "node:test";
import { maxUndeliveredReply, MAX_REPLY_EMPTY, MAX_REPLY_UNAVAILABLE, MAX_REPLY_INTERRUPTED, MAX_REPLY_LIMIT, MAX_REPLY_NOT_SAVED } from "./maxReplyStatus.js";

test("undelivered notices are recognised after the same presentation cleanup as chat", () => {
  for (const notice of [MAX_REPLY_EMPTY, MAX_REPLY_UNAVAILABLE]) {
    assert.equal(maxUndeliveredReply(notice), notice);
    assert.equal(maxUndeliveredReply(` \n\u200b**${notice}**\ufeff `), notice);
  }
});

test("a useful partial, limited or unsaved reply is not discarded as an empty service failure", () => {
  for (const notice of [MAX_REPLY_INTERRUPTED, MAX_REPLY_LIMIT, MAX_REPLY_NOT_SAVED]) {
    assert.equal(maxUndeliveredReply(`A useful first step.\n\n${notice}`), null);
  }
  assert.equal(maxUndeliveredReply("Keep it simple."), null);
  assert.equal(maxUndeliveredReply(`The app showed: \"${MAX_REPLY_UNAVAILABLE}\". That indicates a temporary service issue.`), null);
  assert.equal(maxUndeliveredReply(""), null, "the existing empty-body branch owns a truly blank response");
});
