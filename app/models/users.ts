import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@/app/lib/i18n/locales';
import { SYSTEM_LEVELS } from '@/app/lib/system-levels';

const UsersSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true, select: false },
    urlString: { type: String, required: false }, // user profile image
    organizationIds: [{ type: Schema.Types.ObjectId, ref: 'Organizations' }],
    // Platform bypass level(s), set directly (see app/lib/services/system-access.ts).
    // `'system'` is script-only to grant; `'support'` is grantable from the
    // Users screen. Authorization reads this on every request.
    systemLevel: [{ type: String, enum: SYSTEM_LEVELS, default: [] }],
    mustChangePassword: { type: Boolean, default: false },
    // Set when an operator deactivates the account; absent means active. Kept
    // rather than deleting the user so the audit trail and organization links
    // survive. Enforced at sign-in and on every authorized request (see
    // app/lib/auth.ts and app/lib/authorization.ts) — sessions are stateless
    // JWTs, so the sign-in check alone would leave open sessions working.
    disabledAt: { type: Date },
    language: { type: String, enum: SUPPORTED_LOCALES, default: DEFAULT_LOCALE },
    // Last successful credential sign-in. Written by the auth provider and read
    // by the active-account report — an account with no value here has never
    // signed in, which is exactly what that report is for.
    lastSignInAt: { type: Date },
  },
  { timestamps: true, collection: 'users' },
);

UsersSchema.index({ organizationIds: 1 });
UsersSchema.index({ systemLevel: 1 });
UsersSchema.index({ lastSignInAt: -1 });

type User = InferSchemaType<typeof UsersSchema>;
const Users = (models.Users as Model<User>) || model<User>('Users', UsersSchema);
export default Users;
