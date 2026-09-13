/**
 * Timeline model: each era is a "type: era" wiki entity pointing at a full `.map` snapshot under
 * public/maps/ (see wiki/SCHEMA.md). Entities elsewhere carry an era-keyed `map_ref` and an
 * optional `eras` override block for the handful of fields that change between eras — most of an
 * entity's data (prose, tags, unrelated relations) isn't duplicated per era.
 */
import { DEFAULT_ERA, type MapRef, type WikiEntity, type WikiFrontmatter } from "./types";

export interface Era {
  slug: string;
  label: string;
  order: number;
  mapFile?: string;
}

function toEra(entity: WikiEntity): Era | undefined {
  if (entity.frontmatter.type !== "era") return undefined;
  return {
    slug: entity.slug,
    label: entity.frontmatter.title,
    order: entity.frontmatter.order ?? 0,
    mapFile: entity.frontmatter.map_file
  };
}

export function loadEras(entities: WikiEntity[]): Era[] {
  return entities
    .map(toEra)
    .filter((era): era is Era => era !== undefined)
    .sort((a, b) => a.order - b.order);
}

/** Best-effort "which era is loaded right now", inferred from `?maplink=` matching a known era's map file */
export function currentEraSlug(eras: Era[]): string {
  const maplink = new URL(location.href).searchParams.get("maplink");
  const matched = maplink ? eras.find(era => era.mapFile && maplink.endsWith(era.mapFile)) : undefined;
  return matched?.slug ?? eras[0]?.slug ?? DEFAULT_ERA;
}

/** True if this entity belongs in the given era's view: map-linked there, era-overridden there, or era-agnostic (no map_ref and no eras block at all) */
export function isEntityInEra(entity: WikiEntity, era: string): boolean {
  const { map_ref, eras } = entity.frontmatter;
  if (!map_ref && !eras) return true;
  if (map_ref?.[era]) return true;
  if (eras?.[era]) return true;
  return false;
}

export interface ResolvedEntity {
  frontmatter: WikiFrontmatter;
  mapRef?: MapRef;
}

/** Base frontmatter with that era's override fields shallow-merged on top, plus the map_ref that applies in that era */
export function resolveEntityForEra(entity: WikiEntity, era: string): ResolvedEntity {
  const override = entity.frontmatter.eras?.[era] ?? {};
  return { frontmatter: { ...entity.frontmatter, ...override }, mapRef: entity.frontmatter.map_ref?.[era] };
}
