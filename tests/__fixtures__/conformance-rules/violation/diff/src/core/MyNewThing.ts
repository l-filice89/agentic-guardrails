// PascalCase basename in a kebab-case directory → `conformance/naming-convention`.
// It ALSO has a default export, but the only importer is consumer.ts — itself
// part of this diff — so module shape has no evidence about it and says
// nothing. That is the point: a diff cannot manufacture the evidence it is
// judged by.
const myNewThing = 42;

export default myNewThing;
