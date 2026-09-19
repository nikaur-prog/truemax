/** Small, grounded openers. The caller supplies only the current owner's records. */
export interface MaxPresenceContext {
  name?: string | null;
  hasOwnScan: boolean;
  routines?: readonly {
    id: string;
    title: string;
    status: string;
    startedAt: number | null;
  }[];
  now?: number;
}

export interface MaxPresenceLine {
  id: string;
  text: string;
  action: string;
  question: string;
}

function shortLabel(value: string | null | undefined, limit: number): string {
  const text = (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length > limit) return "";
  return text;
}

/** Calendar days, not an adherence streak or a claim that a product has worked. */
export function routineDay(startedAt: number | null, now: number): number | null {
  if (startedAt === null || !Number.isFinite(startedAt) || !Number.isFinite(now) || startedAt > now) return null;
  const start = new Date(startedAt);
  const today = new Date(now);
  const day = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
    - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86_400_000) + 1;
  return day >= 1 && day <= 36_600 ? day : null;
}

export function maxPresenceLines(context: MaxPresenceContext): MaxPresenceLine[] {
  const name = shortLabel(context.name, 35);
  const lines: MaxPresenceLine[] = [
    { id: "hello", text: name ? `Hey, ${name}. What would you like to work on today?` : "Hey. What would you like to work on today?", action: "Talk it through", question: "Help me choose what to work on today." },
    { id: "plan", text: "Want a plan that fits your day? Let's start with what you want and what you already do.", action: "Build my plan", question: "Help me build a practical plan around my goals and current routine." },
    { id: "check-in", text: "Quick check-in: what has been easy to stick with, and what keeps getting in the way?", action: "Check in", question: "I'd like to check in on my routine and what has been getting in the way." },
    { id: "question", text: "Got a question you've been saving? We can talk it through.", action: "Ask Max", question: "I have a question about my goals and routine." },
  ];
  if (context.hasOwnScan) {
    lines.push(
      { id: "scan-context", text: "We can unpack your latest scan, or leave the numbers aside and focus on your routine.", action: "Understand my scan", question: "Help me understand my latest scan and which readings are worth paying attention to." },
      { id: "photo-note", text: "A useful photo check: keep the camera, lighting and expression consistent when you compare scans.", action: "Photo tips", question: "How can I make my next scan easier to compare with my last one?" },
    );
  } else {
    lines.push({ id: "first-scan", text: "Ready for your first face scan? I can help you get the photo right, or we can start with your goals.", action: "Help me get started", question: "Help me get ready for my first face scan." });
  }
  const seen = new Set<string>();
  const routineLines: MaxPresenceLine[] = [];
  for (const routine of context.routines ?? []) {
    const title = shortLabel(routine.title, 54);
    if (!title || seen.has(title.toLowerCase()) || routine.status !== "running") continue;
    const day = routineDay(routine.startedAt, context.now ?? Date.now());
    if (day === null) continue;
    seen.add(title.toLowerCase());
    routineLines.push({
      id: `routine:${routine.id}`,
      text: `Day ${day} since you started ${title}. How has it been fitting into your day?`,
      action: "Talk about my routine",
      question: `I'd like to check in on ${title}. Ask me how it has been going before suggesting any changes.`,
    });
    if (seen.size === 3) break;
  }
  return [...routineLines, ...lines];
}

/** No storage, inference or request. A visible visit selects one eligible line. */
export function chooseMaxPresence(context: MaxPresenceContext, visit: number, previousId?: string): MaxPresenceLine {
  const lines = maxPresenceLines(context);
  const index = Number.isFinite(visit) ? Math.max(0, Math.floor(visit)) : 0;
  const selected = index % lines.length;
  return lines[selected].id === previousId ? lines[(selected + 1) % lines.length] : lines[selected];
}
