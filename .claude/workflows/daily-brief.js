export const meta = {
  name: 'daily-brief',
  description: 'Three content recommendations for TrueMax from the niche outliers, own audience data and the repo assets',
  whenToUse: 'The owner asks what to post, or the daily brief Routine fires. Pass { date, weekday, rotation, nowIso } as args.',
  phases: [
    { title: 'Gather', detail: 'one discovery call, own audience data, sounds' },
    { title: 'Recommend', detail: 'three drafts from templates' },
    { title: 'Check', detail: 'rules checker, one rewrite per failing draft' },
  ],
}

// ---------------------------------------------------------------------------
// Inputs. The script cannot read the clock, so the skill passes the date.
// ---------------------------------------------------------------------------
const a = args || {}
const DATE = a.date || 'unknown date'
const WEEKDAY = a.weekday || 'unknown weekday'
const ROTATION = a.rotation || 'igtt'
const NOW_ISO = a.nowIso || ''
const BRAND_ID = '6618063'
const TZ = 'Pacific/Auckland'
const OWN_CHANNEL = 'UCk7fSd_-F1O39qjsHuuteNg'
const CREDIT_FLOOR = 20

const RULES = `RULES (every draft is rejected if it breaks one):
1. No em dashes anywhere: not in copy, captions, titles or beats. Use a comma, a full stop or a colon.
2. Plain register. Only a line explicitly spoken by Coach Max may be coach-toned.
3. A rarity is never stated about a person. "1 in 100 faces" about anybody is barred. "About 15% of male faces score higher" is the allowed shape.
4. Verdict words only from: needs work, needs improving, below average, okay, alright, decent, good, very good, top of the scale. Never "attractive", "handsome", "beautiful". No verdict names a real person.
5. A real person's face only through The Cast tool's saved-face library. Otherwise the AI-generated demo cast, which carries the on-screen tag "AI-generated demonstration" and the caption line "Demo faces are AI-generated".
6. No procedures, no supplements, nothing that comes in a bottle. Never "scientifically proven". "Measured" and "compared to a reference set" are the allowed claims.
7. Ethnicity is never inferred from a photograph and never appears in a hook, caption or comparison.
8. The measurement fwhr is never shown.
9. Nothing that needs another person's scan data.
10. No typed numbers. A beat never states a measurement value, a reference average, a score or a percentage that the writer made up. Write the placeholder in square brackets, "[value the scan prints]", "[band the card prints]", and say the number is read off the screen at production time. The only figures a draft may state are the evidence rows' own views and multiples. Never quote a sentence as the app's unless it is in the MEASUREMENTS list or the ASSETS list.
11. The lower face width ratio is indicative: it appears with its value and the word "indicative", never with a band, a percentile or a verdict word.`

const ASSETS = `ASSETS a recommendation may point at (name one per recommendation, exactly as written):
- The Cast (/quick): rundown video of a celebrity from the saved-face library, measurement lines, voice, score card, 15 to 40 s, MP4 download.
- The Cut (/quick): fast trait-led rundown for TikTok, marquee metrics, companions.
- CTA series (public/cta/cta2.mp4): before-and-after AI-actor story with the universal outro.
- Demo cast loops (public/demo/*.mp4): six AI-generated faces with video loops.
- Voiced example (public/demo/voiced-example.mp4): the voiced-analysis exemplar.
- Scan screen recording: a front and side scan on a demo face with the measurement lines drawn.
- Coach Max clip: the character answering one question in the chat, screen recorded.
- League montage (public/league/montage.mp4).`

const MEASUREMENTS = `MEASUREMENTS the app prints and a payoff may use (never fwhr): facial thirds, forehead ratio, canthal tilt, eye separation ratio, interocular to face width, nose width ratio, nasal projection, philtrum length, lip ratio, chin height ratio, jaw to cheekbone width ratio, gonial angle (side), nasofrontal angle (side), nasolabial angle (side), chin projection (side), ramus to mandible (side), lower face width ratio (soft tissue, indicative), overall score out of 10 with the percentile band.`

const TOOLS_NOTE = `Load every connector tool before calling it: ToolSearch with "select:<tool name>". Return raw data only; your final message IS the return value.`

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const OUTLIER_ROW = {
  type: 'object',
  properties: {
    platform: { type: 'string', enum: ['youtube', 'instagram', 'tiktok'] },
    creator: { type: 'string' },
    followers: { type: 'number' },
    views: { type: 'number' },
    multiple: { type: 'number', description: 'views over the creator median, or the breakout score' },
    lengthSec: { type: 'number' },
    title: { type: 'string' },
    hook: { type: 'string', description: 'the first three seconds, text and visual' },
    format: { type: 'string', description: 'the subject-free production template' },
    audio: { type: 'string' },
    url: { type: 'string' },
    publishedAt: { type: 'string' },
    effort: { type: 'string' },
    relevance: { type: 'string', enum: ['core', 'adjacent', 'off'] },
  },
  required: ['platform', 'creator', 'views', 'multiple', 'title', 'hook', 'format', 'relevance'],
}

const DISCOVERY_SCHEMA = {
  type: 'object',
  properties: {
    balanceBefore: { type: 'number' },
    balanceAfter: { type: 'number' },
    callMade: { type: 'string', description: 'the tool called, or "none"' },
    skippedReason: { type: 'string' },
    rows: { type: 'array', items: OUTLIER_ROW },
  },
  required: ['balanceBefore', 'balanceAfter', 'callMade', 'rows'],
}

const AUDIENCE_SCHEMA = {
  type: 'object',
  properties: {
    bestTimes: {
      type: 'object',
      properties: {
        tiktok: { type: 'array', items: { type: 'object', properties: { day: { type: 'string' }, hour: { type: 'number' }, value: { type: 'number' } }, required: ['day', 'hour', 'value'] } },
        instagram: { type: 'array', items: { type: 'object', properties: { day: { type: 'string' }, hour: { type: 'number' }, value: { type: 'number' } }, required: ['day', 'hour', 'value'] } },
      },
      required: ['tiktok', 'instagram'],
    },
    recentPosts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          platform: { type: 'string' },
          publishedAt: { type: 'string' },
          caption: { type: 'string' },
          views: { type: 'number' },
          interactions: { type: 'number' },
          url: { type: 'string' },
        },
        required: ['platform', 'publishedAt', 'caption', 'views'],
      },
    },
    medianViews: { type: 'object', properties: { tiktok: { type: 'number' }, instagram: { type: 'number' } } },
    notes: { type: 'string' },
  },
  required: ['bestTimes', 'recentPosts', 'notes'],
}

const SOUNDS_SCHEMA = {
  type: 'object',
  properties: {
    available: { type: 'boolean' },
    note: { type: 'string' },
    tracks: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, artist: { type: 'string' }, genre: { type: 'string' }, link: { type: 'string' } }, required: ['id', 'title'] } },
  },
  required: ['available', 'note', 'tracks'],
}

const REC_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['copy', 'iterate', 'trend'] },
    headline: { type: 'string', description: 'one line naming the play' },
    evidence: { type: 'array', items: { type: 'string' }, description: 'each: creator, views, multiple, length, hook, url' },
    hook: { type: 'string' },
    beats: { type: 'array', items: { type: 'object', properties: { screen: { type: 'string' }, said: { type: 'string' } }, required: ['screen', 'said'] } },
    measurement: { type: 'string' },
    asset: { type: 'string' },
    platform: { type: 'string', enum: ['tiktok', 'instagram', 'youtube'] },
    slot: { type: 'string', description: 'day and hour in Pacific/Auckland with the reason' },
    titles: { type: 'array', items: { type: 'string' } },
    caption: { type: 'string' },
    sound: { type: 'string' },
    effortMinutes: { type: 'number' },
    why: { type: 'string' },
  },
  required: ['kind', 'headline', 'evidence', 'hook', 'beats', 'measurement', 'asset', 'platform', 'slot', 'titles', 'caption', 'effortMinutes', 'why'],
}

const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: { type: 'object', properties: { index: { type: 'number' }, pass: { type: 'boolean' }, problems: { type: 'array', items: { type: 'string' } } }, required: ['index', 'pass', 'problems'] },
    },
  },
  required: ['verdicts'],
}

// ---------------------------------------------------------------------------
// Gather
// ---------------------------------------------------------------------------
phase('Gather')

function discoveryPrompt() {
  const common = `${TOOLS_NOTE}
You are the discovery step of the TrueMax daily brief for ${DATE} (${WEEKDAY}). Rotation: ${ROTATION}.
First call mcp__vidIQ_for_Claude__vidiq_balance (free) and record totalCredits as balanceBefore.
If totalCredits is below ${CREDIT_FLOOR}, make NO discovery call, set callMade to "none", give skippedReason, rows [], balanceAfter = balanceBefore.
Otherwise make exactly ONE discovery call as instructed below, then call vidiq_balance again for balanceAfter.
Normalise every result into a row. Mark relevance: "core" if it is about face rating, looksmaxxing, facial measurement, jawline, glow up or an app that rates faces; "adjacent" if it is grooming, skincare, hair or fitness for the face; "off" otherwise (gaming skins, product rating, unrelated). Keep off rows in the list but marked, do not drop them.
For YouTube rows, fill hook and format from the title and what the thumbnail shows; say "from title" when that is all you have. For Instagram and TikTok rows use the fields the tool returns (hook, format, audio, effort, audience).`
  if (ROTATION === 'igtt') {
    return `${common}
DISCOVERY CALL: mcp__vidIQ_for_Claude__vidiq_instagram_tiktok_outlier_search with query "face rating looksmaxxing glow up jawline", audienceQuery "Culture/Region: English-speaking, NZ/AU/US/UK; Global: true; Demographics: men 16-30 interested in looksmaxxing, face rating, self-improvement;", resultsPerPlatform 6, embeddingType concept.`
  }
  if (ROTATION === 'yt-competitors') {
    return `${common}
DISCOVERY CALL: first mcp__vidIQ_for_Claude__vidiq_list_competitors with youtubeChannelId "${OWN_CHANNEL}" (free). If it returns one or more channel ids, call mcp__vidIQ_for_Claude__vidiq_outliers with channelIds set to those ids, contentType "all", publishedWithin "thisMonth", sort "breakoutScore", limit 12. If it returns none, call vidiq_outliers with keyword "looksmaxxing face rating", contentType "short", publishedWithin "thisMonth", sort "breakoutScore", limit 12 and note the fallback in skippedReason.`
  }
  if (ROTATION === 'yt-trending') {
    return `${common}
DISCOVERY CALL: mcp__vidIQ_for_Claude__vidiq_trending_videos with videoFormat "short", titleQuery "looksmaxxing face rating jawline", limit 12, sortBy "vph".`
  }
  if (ROTATION === 'none') {
    return `${common}
DISCOVERY CALL: none today (Sunday). Call vidiq_balance only, set callMade "none", skippedReason "Sunday, no discovery", rows [].`
  }
  return `${common}
DISCOVERY CALL: mcp__vidIQ_for_Claude__vidiq_outliers with keyword "looksmaxxing face rating", contentType "short", publishedWithin "thisMonth", sort "breakoutScore", limit 12.`
}

const audiencePrompt = `${TOOLS_NOTE}
You are the audience step of the TrueMax daily brief for ${DATE} (${WEEKDAY}). Now is ${NOW_ISO}.
Metricool brand id "${BRAND_ID}", timezone "${TZ}".
1. mcp__Metricool__getBestTimeToPostByNetwork for socialNetwork "tiktok" and again for "instagram", fromDate 30 days before ${DATE} and toDate ${DATE}, formatted as ISO 8601 with the +12:00 offset (for example 2026-08-03T00:00:00+12:00). Return the top five day/hour cells per network by value.
2. mcp__Metricool__getAnalyticsDataByMetrics for the last 14 days ending ${DATE} with metrics ["TKPO02","TKPO05","TKPO07","TKPO08","TKPO09","TKPO10","TKPO03"] (TikTok videos: published, description, views, likes, comments, shares, url). Then the same call with ["IGRE02","IGRE03","IGRE23","IGRE09","IGRE06"] (Instagram reels: date, content, views, interactions, url). If a call errors, say so in notes and continue.
3. recentPosts: every post from those two calls, newest first. medianViews: the median views per platform over the rows you got (omit a platform with no rows).
Do not invent a post. An empty account is a valid answer.`

const soundsPrompt = `${TOOLS_NOTE}
You are the sound step of the TrueMax daily brief. Call mcp__higgsfield_au__tiktok_accounts. If there is no active account, return available false, note "No TikTok account is connected in Higgsfield; connect one with tiktok_connect to get commercial-library sounds", tracks []. If there is an active account, call mcp__higgsfield_au__tiktok_music_trending with its connector_id, date_range "7DAY", limit 10, and return the tracks with their listen links.`

const [discovery, audience, sounds] = await parallel([
  () => agent(discoveryPrompt(), { label: 'gather:discovery', phase: 'Gather', schema: DISCOVERY_SCHEMA }),
  () => agent(audiencePrompt, { label: 'gather:audience', phase: 'Gather', schema: AUDIENCE_SCHEMA }),
  () => agent(soundsPrompt, { label: 'gather:sounds', phase: 'Gather', schema: SOUNDS_SCHEMA }),
])

const disc = discovery || { balanceBefore: 0, balanceAfter: 0, callMade: 'failed', skippedReason: 'discovery agent returned nothing', rows: [] }
const aud = audience || { bestTimes: { tiktok: [], instagram: [] }, recentPosts: [], notes: 'audience agent returned nothing' }
const snd = sounds || { available: false, note: 'sound agent returned nothing', tracks: [] }
log(`discovery: ${disc.callMade}, ${disc.rows.length} rows, credits ${disc.balanceBefore} to ${disc.balanceAfter}; posts on record: ${aud.recentPosts.length}; sounds: ${snd.available ? snd.tracks.length : 'not connected'}`)

// ---------------------------------------------------------------------------
// Recommend
// ---------------------------------------------------------------------------
phase('Recommend')

const usable = disc.rows.filter((r) => r.relevance !== 'off')
const gathered = JSON.stringify({ date: DATE, weekday: WEEKDAY, rotation: ROTATION, outliers: usable, audience: aud, sounds: snd }, null, 1)

const TEMPLATE = `Write ONE recommendation as the schema asks. Requirements:
- evidence: two or more outlier rows when the play is a format (creator, views, multiple, length, hook, url per line); one row is a lead, say so in why.
- hook: the first line on screen, under twelve words.
- beats: five to eight, each with what is on screen and what is said or shown. The payoff beat names the measurement from the MEASUREMENTS list and reads a number off the screen.
- measurement: one from the list.
- asset: one from ASSETS, named exactly.
- platform and slot: pick the platform the evidence came from and the best hour for it from audience.bestTimes, written as "Thursday 21:00 NZT" with the value in brackets; if bestTimes is empty say "no audience data yet, default 19:00 NZT".
- titles: three, each under 60 characters.
- caption: one caption, ending with "get yours at truemax.app" exactly once and, when a demo face is used, the line "Demo faces are AI-generated" exactly once.
- sound: one of sounds.tracks by title if available, else "none, sounds not connected".
- effortMinutes: honest, from the asset (a Cast rundown is 20, a screen recording 30, a CTA cut 15).
- why: two sentences on why this, now, in plain register.`

const recPrompt = (kind, avoid) => `You are writing the "${kind}" recommendation of the TrueMax daily brief for ${DATE}.
TrueMax measures a face from two photographs on the person's own device, compares the measurements to a reference set and shows the arithmetic. Its content lane is the receipt: a claim, then the measurement that settles it.
${RULES}
${ASSETS}
${MEASUREMENTS}
GATHERED DATA:
${gathered}
KIND "${kind}" means:
- copy: the strongest format cluster in the outliers (two or more rows sharing a format). Our version of that exact format with a TrueMax measurement in the payoff.
- iterate: our own best recent post from audience.recentPosts (highest views over medianViews). A follow-up that keeps its hook shape and changes the measurement. If recentPosts is empty, write a second copy-the-format play from a DIFFERENT cluster than the strongest one and say in why that there is no own post to iterate on yet.
- trend: the freshest outlier (newest publishedAt) or a sound from sounds.tracks with a format that fits it. Something to post within 48 hours.
${avoid ? `ALREADY TAKEN by the "copy" recommendation, so this one must use a DIFFERENT payoff measurement, a different hook and a different asset: measurement "${avoid.measurement}", hook "${avoid.hook}", asset "${avoid.asset}". Three recommendations that say the same thing are one recommendation.` : ''}
${TEMPLATE}`

// The copy play goes first, alone, because it is the one that claims the
// week's strongest format; the other two are written against it so the
// brief does not hand the owner the same video three times with three names.
const copyDraft = await agent(recPrompt('copy'), { label: 'recommend:copy', phase: 'Recommend', schema: REC_SCHEMA })
const others = await parallel(['iterate', 'trend'].map((kind) => () =>
  agent(recPrompt(kind, kind === 'trend' ? copyDraft : null), { label: `recommend:${kind}`, phase: 'Recommend', schema: REC_SCHEMA })))

let recs = [copyDraft, ...others].filter(Boolean)
log(`${recs.length} of 3 drafts written`)

// ---------------------------------------------------------------------------
// Check, and one rewrite per failing draft
// ---------------------------------------------------------------------------
phase('Check')

const checkPrompt = `You are the checker for the TrueMax daily brief. Read each recommendation against the RULES and reject any that breaks one. Also reject: a headline or hook that names a real person with a verdict word; a caption missing "Demo faces are AI-generated" when the asset is the demo cast, the CTA series or the voiced example; an evidence list with fewer than two rows on a "copy" play unless why says it is a lead; any em dash character; any "in every 100" or "1 in N" about a person; a slot that names a day other than a real weekday; any typed measurement value, reference average, score or percentage in a beat, caption or title that is not a placeholder in square brackets (rule 10); "get yours at truemax.app" or "Demo faces are AI-generated" appearing twice in one caption.
${RULES}
RECOMMENDATIONS (index is the array position):
${JSON.stringify(recs, null, 1)}
Return one verdict per index with the concrete problem lines.`

const check = await agent(checkPrompt, { label: 'check:rules', phase: 'Check', schema: CHECK_SCHEMA })
const verdicts = (check && check.verdicts) || recs.map((_, index) => ({ index, pass: true, problems: ['checker returned nothing; unverified'] }))
const failing = verdicts.filter((v) => !v.pass && recs[v.index])
log(`${failing.length} draft(s) rejected by the checker`)

const rewritten = await parallel(failing.map((v) => () =>
  agent(`Rewrite this TrueMax brief recommendation so it passes. Keep the play, fix only the problems. Return the full recommendation as the schema asks.
${RULES}
${ASSETS}
${MEASUREMENTS}
PROBLEMS: ${v.problems.join(' | ')}
RECOMMENDATION: ${JSON.stringify(recs[v.index], null, 1)}
${TEMPLATE}`, { label: `rewrite:${recs[v.index].kind}`, phase: 'Check', schema: REC_SCHEMA })))

failing.forEach((v, i) => { if (rewritten[i]) recs[v.index] = rewritten[i] })
const rewrittenKinds = failing.filter((_, i) => rewritten[i]).map((v) => recs[v.index].kind)

// ---------------------------------------------------------------------------
// Assemble. Plain JavaScript, no agent: the brief's shape is fixed.
// ---------------------------------------------------------------------------
const spend = Math.max(0, (disc.balanceBefore || 0) - (disc.balanceAfter || 0))
const lines = []
lines.push(`# TrueMax brief, ${DATE} (${WEEKDAY})`)
lines.push('')
lines.push(`Discovery: ${disc.callMade}${disc.skippedReason ? ` (${disc.skippedReason})` : ''}. vidIQ credits ${disc.balanceBefore} before, ${disc.balanceAfter} after, ${spend} spent. ${usable.length} usable outliers of ${disc.rows.length}.`)
if (rewrittenKinds.length) lines.push(`Checker rewrote: ${rewrittenKinds.join(', ')} (one pass; read those two with care).`)
lines.push('')
const order = { copy: 1, iterate: 2, trend: 3 }
recs.sort((x, y) => (order[x.kind] || 9) - (order[y.kind] || 9))
recs.forEach((r, i) => {
  const label = r.kind === 'copy' ? 'Copy the format' : r.kind === 'iterate' ? 'Iterate on our own best' : 'Trend, post within 48 hours'
  lines.push(`## ${i + 1}. ${label}: ${r.headline}`)
  lines.push('')
  lines.push(`**Why.** ${r.why}`)
  lines.push('')
  lines.push('**Evidence.**')
  r.evidence.forEach((e) => lines.push(`- ${e}`))
  lines.push('')
  lines.push(`**Hook.** ${r.hook}`)
  lines.push('')
  lines.push('**Beats.**')
  r.beats.forEach((b, j) => lines.push(`${j + 1}. Screen: ${b.screen} | Said: ${b.said}`))
  lines.push('')
  lines.push(`**Payoff measurement.** ${r.measurement}`)
  lines.push(`**Asset.** ${r.asset}`)
  lines.push(`**Post.** ${r.platform}, ${r.slot}`)
  lines.push(`**Titles.** ${r.titles.join(' / ')}`)
  lines.push(`**Caption.** ${r.caption}`)
  lines.push(`**Sound.** ${r.sound || 'none'}`)
  lines.push(`**Effort.** about ${r.effortMinutes} minutes`)
  lines.push('')
})
lines.push('## Yesterday')
lines.push('')
if (!aud.recentPosts.length) {
  lines.push(`No posts on record in the last 14 days on the connected TikTok and Instagram accounts. ${aud.notes}`)
} else {
  aud.recentPosts.slice(0, 6).forEach((p) => {
    const med = aud.medianViews && aud.medianViews[p.platform]
    const mult = med ? ` (${(p.views / med).toFixed(1)}x the account median)` : ''
    lines.push(`- ${p.platform}, ${p.publishedAt}: ${p.views} views${mult}. "${(p.caption || '').slice(0, 90)}" ${p.url || ''}`)
  })
  lines.push('')
  lines.push(aud.notes)
}
lines.push('')
lines.push('## Sounds')
lines.push('')
lines.push(snd.available ? snd.tracks.slice(0, 5).map((t) => `- ${t.title}${t.artist ? `, ${t.artist}` : ''} ${t.link || ''}`).join('\n') : snd.note)
lines.push('')
lines.push('## Discovery rows this run')
lines.push('')
disc.rows.forEach((r) => lines.push(`- [${r.relevance}] ${r.platform} ${r.creator} (${r.followers || '?'} followers): ${r.views} views, ${r.multiple}x, ${r.lengthSec || '?'}s. ${r.title}. Hook: ${r.hook}. Format: ${r.format}. ${r.url || ''}`))

return { markdown: lines.join('\n'), spend, skipped: disc.callMade === 'none' ? disc.skippedReason || 'no discovery' : null, rewritten: rewrittenKinds }
