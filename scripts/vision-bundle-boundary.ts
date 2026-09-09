interface BundleChunk {
  type: "chunk";
  fileName: string;
  isEntry: boolean;
  imports: string[];
  modules: Record<string, unknown>;
}
interface BundleAsset { type: "asset" }

/** Initial HTML preloads follow static imports, not dynamic imports. */
export function assertDeferredVisionRuntime(bundle: Record<string, BundleChunk | BundleAsset>): void {
  const chunks = Object.values(bundle).filter((item): item is BundleChunk => item.type === "chunk");
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  for (const entry of chunks.filter((chunk) => chunk.isEntry)) {
    const pending = [entry];
    const seen = new Set<string>();
    while (pending.length) {
      const chunk = pending.pop()!;
      if (seen.has(chunk.fileName)) continue;
      seen.add(chunk.fileName);
      if (Object.keys(chunk.modules).some((id) => id.replace(/\\/g, "/").includes("/@mediapipe/tasks-vision/"))) {
        throw new Error(`Vision runtime is eagerly loaded by ${entry.fileName} through ${chunk.fileName}`);
      }
      for (const name of chunk.imports) {
        const imported = byName.get(name);
        if (imported) pending.push(imported);
      }
    }
  }
}
