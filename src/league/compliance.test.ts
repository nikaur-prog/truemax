import assert from "node:assert/strict";
import test from "node:test";
import {
  campaignTag,
  captionIncludesCampaignTag,
  submissionCanAccrue,
} from "./compliance.js";

test("campaign tags are normalised to one narrow token", () => {
  assert.equal(campaignTag("  #TrueMax  "), "#truemax");
  assert.equal(campaignTag("truemax"), null);
  assert.equal(campaignTag("#tm"), null);
  assert.equal(campaignTag("#true-max"), null);
  assert.equal(campaignTag("#truemax another"), null);
  assert.equal(campaignTag(`#${"a".repeat(33)}`), null);
});

test("caption compliance requires the exact campaign hashtag", () => {
  assert.equal(captionIncludesCampaignTag("My glow up #TrueMax #ad", "#truemax"), true);
  assert.equal(captionIncludesCampaignTag("#ad,#truemax!", "#TrueMax"), true);
  assert.equal(captionIncludesCampaignTag("#truemaxgiveaway", "#truemax"), false);
  assert.equal(captionIncludesCampaignTag("truemax", "#truemax"), false);
  assert.equal(captionIncludesCampaignTag(null, "#truemax"), false);
  assert.equal(captionIncludesCampaignTag("#truemax", "not a tag"), false);
});

test("a submission accrues only after every compliance decision", () => {
  const complete = {
    status: "approved",
    captionCompliant: true,
    ctaVerifiedAt: "2026-08-31T00:00:00.000Z",
    disclosureVerifiedAt: "2026-08-31T00:00:00.000Z",
  };
  assert.equal(submissionCanAccrue(complete), true);
  assert.equal(submissionCanAccrue({ ...complete, status: "pending" }), false);
  assert.equal(submissionCanAccrue({ ...complete, captionCompliant: false }), false);
  assert.equal(submissionCanAccrue({ ...complete, ctaVerifiedAt: null }), false);
  assert.equal(submissionCanAccrue({ ...complete, disclosureVerifiedAt: null }), false);
});
