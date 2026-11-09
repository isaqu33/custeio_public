import 'server-only';

import bcrypt from 'bcryptjs';

// Pre-computed at module load: a valid bcrypt hash used as the comparison
// target when no user matches. Forces bcrypt.compare to do its work even
// on "user not found" so response timing doesn't leak which emails exist.
// The plaintext is irrelevant — it must never match a real password.
const DUMMY_HASH_FOR_TIMING_DEFENSE = bcrypt.hashSync('rayai-dummy-target', 10);

export async function hashPassword(password: string) {
  const saltRounds = 10;
  const salt = await bcrypt.genSalt(saltRounds);
  const hashedPassword = await bcrypt.hash(password, salt);
  return hashedPassword;
}

export async function comparePassword(password: string, hashedPassword: string) {
  const match = await bcrypt.compare(password, hashedPassword);
  return match; // Returns true if passwords match, false otherwise
}

// Verifies a password against a possibly-missing user record in constant
// time (the wall-clock cost of bcrypt.compare dominates the DB lookup),
// preventing email-enumeration via response timing. Returns false if the
// user doesn't exist OR the password doesn't match.
export async function verifyPasswordTimingConstant(
  password: string,
  userHashedPassword: string | null | undefined,
): Promise<boolean> {
  const target = userHashedPassword ?? DUMMY_HASH_FOR_TIMING_DEFENSE;
  const match = await bcrypt.compare(password, target);
  return match && !!userHashedPassword;
}
