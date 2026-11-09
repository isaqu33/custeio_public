// Generic shape returned by Mongoose `.lean()` when the schema is not generically typed.
// Use for `.map((doc: LeanDoc) => ...)` patterns; stringify _id with `String(doc._id)`
// and cast other field accesses at the use site (all are typed as `unknown`).
export type LeanDoc = { _id: unknown } & Record<string, unknown>;
