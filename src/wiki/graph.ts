import { buildSlugIndex, resolveTarget } from "./entities";
import { extractWikilinks } from "./markdown";
import type { WikiEdge, WikiEntity, WikiGraph } from "./types";

export function buildGraph(entities: WikiEntity[]): WikiGraph {
  const index = buildSlugIndex(entities);
  const edges: WikiEdge[] = [];
  const seen = new Set<string>();
  const brokenLinks = new Map<string, string[]>();

  const addEdge = (edge: WikiEdge) => {
    const key = `${edge.from}->${edge.to}:${edge.kind}:${edge.label ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(edge);
  };

  const recordBroken = (from: string, target: string) => {
    const list = brokenLinks.get(from) ?? [];
    list.push(target);
    brokenLinks.set(from, list);
  };

  for (const entity of entities) {
    for (const target of extractWikilinks(entity.body)) {
      const resolved = resolveTarget(index, target);
      if (!resolved) recordBroken(entity.slug, target);
      else if (resolved.slug !== entity.slug) addEdge({ from: entity.slug, to: resolved.slug, kind: "link" });
    }

    for (const [label, target] of Object.entries(entity.frontmatter.relations ?? {})) {
      const resolved = resolveTarget(index, target);
      if (!resolved) recordBroken(entity.slug, target);
      else if (resolved.slug !== entity.slug)
        addEdge({ from: entity.slug, to: resolved.slug, kind: "relation", label });
    }
  }

  return { entities, edges, brokenLinks };
}
