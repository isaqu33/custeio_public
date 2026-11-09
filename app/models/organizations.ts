import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';

// An Organization is the Cliente: the paying customer, holding users and billing.
// It has no CNPJ of its own — a Cliente can own multiple Stores (Lojas), each one
// its own CNPJ with its own Alloy account. See app/models/stores.ts.
const OrganizationSchema = new Schema(
  {
    // --- Identity ---
    name: { type: String, required: true, trim: true },

    // --- Setup and onboarding (consultative) ---
    // A salesperson creates the organization in `onboarding`; the owner claims
    // it (via `inviteToken`) and it graduates to `active`. `suspended` and
    // `canceled` are later lifecycle states, not reachable from creation.
    status: {
      type: String,
      enum: ['onboarding', 'active', 'suspended', 'canceled'],
      required: true,
      default: 'onboarding',
    },
    // Lets the client claim the account a salesperson created for them.
    // Sparse so only organizations with an outstanding invite hold one.
    inviteToken: { type: String, unique: true, sparse: true },
    // When the outstanding invite stops working. Absent on an invite issued
    // before expiry existed, which is treated as open-ended (an operator can
    // still revoke it). Cleared together with `inviteToken`.
    inviteExpiresAt: { type: Date },

    // --- Financial / billing (SaaS) ---
    asaasCustomerId: { type: String, trim: true },
    // Gates whether this organization's Bull jobs should keep running.
    billingStatus: {
      type: String,
      enum: ['up_to_date', 'past_due'],
      required: true,
      default: 'up_to_date',
    },
  },
  { timestamps: true, collection: 'organizations' },
);

OrganizationSchema.index({ status: 1 });

type Organization = InferSchemaType<typeof OrganizationSchema>;
const Organizations =
  (models.Organizations as Model<Organization>) ||
  model<Organization>('Organizations', OrganizationSchema);
export default Organizations;
