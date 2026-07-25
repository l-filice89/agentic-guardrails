// OBVIOUSLY FAKE credentials only — vendor-documented SHAPES with obviously
// fake tails (never the vendors' PUBLISHED samples, which are allowlisted
// as non-secrets). The comment below proves the regex tier reads raw text,
// not the AST:
// deploy key: AKIAFAKEFAKEFAKEFAKE
export const region = "us-east-1";

// GitHub fine-grained PAT shape (error tier), obviously fake tail:
// github_pat_FAKE0FAKE0FAKE0FAKE0FAKE0
export const service = "github";

// Generic secret-shaped assignment (warning tier): fake, non-placeholder value.
export const apiKey = "not-a-real-secret-0000";
