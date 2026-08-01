// Fixture data for the import-graph golden test — parsed, never executed.
import * as tsc from "typescript"; // external package, resolvable from the repo root
import { aliased } from "@alias/target"; // tsconfig `paths` alias
import { fromBarrel } from "./barrel"; // barrel re-export chain
import "./does-not-exist"; // unresolvable relative — must degrade, not throw
import "unresolvable-pkg-xyz"; // unresolved bare specifier — external edge + degraded
import type { SomeType } from "./types"; // type-only (declaration modifier)
import { type OnlyInline } from "./types2"; // type-only (inline modifiers only)

export async function load(): Promise<unknown> {
  return await import("./lazy"); // dynamic import (literal)
}

export async function loadByName(name: string): Promise<unknown> {
  const modName = `./${name}`;
  return await import(modName); // non-literal dynamic import — degraded, no edge
}

export const usesAll: SomeType = { value: aliased + fromBarrel };
export const inline: OnlyInline | undefined = undefined;
export const kind = tsc.SyntaxKind.ImportDeclaration;
