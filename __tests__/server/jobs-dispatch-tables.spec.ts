/**
 * @jest-environment node
 */
export {};

/**
 * `jobRegistry` (handlers) and `jobPayloadSchemas` (payload parsing) are both
 * keyed by JobKind, but nothing forces one to gain a kind when the other does.
 * `billing.export.csv` and `active-account-report.csv` both shipped registered
 * and creatable while the runner had no branch for them, so the failure only
 * appeared once a real job reached the worker: "Unsupported job kind".
 *
 * The runner is now table-driven, and this keeps the two tables in step.
 */
describe('job dispatch tables', () => {
  it('has a payload schema for every registered handler', () => {
    const { jobRegistry } = require('@/app/jobs/registry');
    const { jobPayloadSchemas } = require('@/app/lib/jobs/schemas');

    expect(Object.keys(jobPayloadSchemas).sort()).toEqual(Object.keys(jobRegistry).sort());
  });

  it('registers a handler for every ad-hoc kind the API accepts', () => {
    const { jobRegistry } = require('@/app/jobs/registry');

    // Kinds a user can start by hand, mirrored from the create route's union.
    for (const kind of ['users.export.csv', 'organizations.export.csv']) {
      expect(typeof jobRegistry[kind]).toBe('function');
    }
  });
});
