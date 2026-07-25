// The importer that would make MyNewThing.ts look default-bound — except it
// is part of the same diff, so its edges carry no evidence.
import myNewThing from "./MyNewThing.js";

export function consume(): number {
  return myNewThing;
}
