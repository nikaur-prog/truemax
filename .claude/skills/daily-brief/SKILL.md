---
name: daily-brief
description: Run the TrueMax daily content brief. Three "what to post today" recommendations built from the niche's outliers (vidIQ), the account's own audience data (Metricool), the commercial sound library (Higgsfield) and the repo's assets, delivered as a Gmail draft. Use when the owner says "run the brief", "what should I post today", or when the daily Routine fires.
---

# The daily brief

Spec: `docs/DAILY_BRIEF_AND_UI_ROUND_PLAN.md`, section 1. This skill is B1: the
skill, the saved workflow, and a hand run. B2 onward (the Notion archive, the
Routine, the yesterday write-back) extend it without changing the shape.

## Constants

| what | value |
|---|---|
| Metricool brand id | `6618063` (brand `tryreckonapp`; TikTok `truemaxapp`, Instagram `tryreckonapp`) |
| Timezone | `Pacific/Auckland` |
| vidIQ own channel | `UCk7fSd_-F1O39qjsHuuteNg` |
| Recipient | the owner's address, `support@ascendnz.online` |
| Credit floor | discovery stops when vidIQ `totalCredits` is below 20 |
| Watch calls | at most two a week, 10 credits each, only when a beat script needs one video's exact wording |

## Rotation, one discovery call a day

| NZ weekday | rotation | vidIQ call |
|---|---|---|
| Monday, Thursday | `igtt` | `vidiq_instagram_tiktok_outlier_search`, query "face rating looksmaxxing glow up jawline", audienceQuery `Culture/Region: English-speaking, NZ/AU/US/UK; Global: true; Demographics: men 16-30 interested in looksmaxxing, face rating, self-improvement;`, 6 per platform |
| Tuesday, Friday | `yt-keyword` | `vidiq_outliers`, keyword "looksmaxxing face rating", contentType short, publishedWithin thisMonth, sort breakoutScore, limit 12 |
| Wednesday | `yt-competitors` | `vidiq_list_competitors` for the own channel (free); if any, `vidiq_outliers` with those channelIds, contentType all, publishedWithin thisMonth; if none, fall back to `yt-keyword` |
| Saturday | `yt-trending` | `vidiq_trending_videos`, videoFormat short, titleQuery "looksmaxxing face rating jawline", limit 12 |
| Sunday | `none` | no discovery; the brief is the yesterday block plus the week's formats |

## Steps

1. Work out the brief's date in New Zealand time:
   `TZ=Pacific/Auckland date +%Y-%m-%d` and `TZ=Pacific/Auckland date +%A`.
   When run in the NZ evening, the brief is for the next morning: add one day.
2. Pick the rotation from the table.
3. Run the saved workflow:
   `Workflow({ name: "daily-brief", args: { date, weekday, rotation, nowIso } })`
   where `nowIso` is `date -u +%Y-%m-%dT%H:%M:%SZ`. The script needs the
   timestamp passed in; it cannot read the clock itself.
4. The workflow returns `{ markdown, spend, skipped }`. Create the Gmail
   draft with `mcp__Gmail__create_draft` to the recipient, subject
   `TrueMax brief, <date>`, body = the markdown. A draft, never a send.
5. Print the brief in the chat as well, and the credit spend line.

## The rules every recommendation is checked against

These are the product's standing rules (`CLAUDE.md`) applied to content. The
checker agent rejects a draft that breaks one; it does not quietly fix it.

1. No em dashes anywhere in the copy, captions or titles.
2. Plain register. Only a line spoken by Coach Max may be coach-toned.
3. A rarity is never stated about a person. "1 in 100 faces" about anybody
   is barred. "About 15% of male faces score higher" is the allowed shape.
4. Verdict words come from the ladder only: needs work, needs improving,
   below average, okay, alright, decent, good, very good, top of the scale.
   Never "attractive", "handsome", "beautiful". No verdict names a real person.
5. Faces: a real person's face only through The Cast tool's saved-face
   library, which the product already publishes; otherwise the demo cast
   (AI-generated). Any AI-actor clip carries the on-screen "AI-generated
   demonstration" tag and the caption line "Demo faces are AI-generated".
6. No procedures, no supplements, nothing that comes in a bottle. No
   "scientifically proven"; the validation doc allows "measured" and
   "compared to a reference set".
7. Ethnicity is never inferred from a photograph and never appears in a
   hook, caption or comparison.
8. `fwhr` is never shown in a video.
9. Nothing that would need another person's scan data.

## Assets the recommendations may point at

| asset | what it is | where |
|---|---|---|
| The Cast | rundown video of a celebrity from the saved-face library, measurement lines, voice, score card, 15 to 40 s, MP4 download | `/quick`, Cast tool |
| The Cut | fast trait-led rundown for TikTok, marquee metrics, companions | `/quick`, Cut tool |
| CTA series | before-and-after AI-actor story with the universal outro | `public/cta/cta2.mp4`, `src/ui/ctaSeries.ts` |
| Demo cast loops | six AI-generated faces with video loops | `public/demo/{adrian,amara,dev,freya,kai,mei}.{jpg,mp4}` |
| Voiced example | the $2.99 voiced-analysis exemplar | `public/demo/voiced-example.mp4` |
| Scan screen recording | a front and side scan on a demo face, measurement lines drawn | any device, demo face |
| Coach Max clip | the character answering one question in the chat | screen record the chat |
| League montage | the Creator League reel | `public/league/montage.mp4` |
| Polisher, Clips Library | League tools for clipping and enhancing | `/league` |

## What B1 does not do

No Notion archive, no Routine, no write-back of outcomes. Those are B2 to
B4 in the plan. If the Higgsfield TikTok account is not connected, the
sound block says so and the rest of the brief stands.
