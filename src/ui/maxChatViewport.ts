/** Keep the composer and Close control inside the visible phone keyboard area. */
export function bindMaxChatViewport(host: HTMLElement): () => void {
  const win = host.ownerDocument.defaultView!;
  const viewport = win.visualViewport;
  let frame: number | null = null;
  const sync = (): void => {
    frame = null;
    const height = viewport?.height ?? win.innerHeight;
    host.style.setProperty("--max-chat-height", `${height}px`);
    host.style.setProperty("--max-chat-top", `${viewport?.offsetTop ?? 0}px`);
    host.classList.toggle("maxchat-compact", height <= 460);
  };
  const schedule = (): void => {
    if (frame === null) frame = win.requestAnimationFrame(sync);
  };
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  win.addEventListener("resize", schedule);
  sync();
  return () => {
    if (frame !== null) win.cancelAnimationFrame(frame);
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
    win.removeEventListener("resize", schedule);
  };
}
