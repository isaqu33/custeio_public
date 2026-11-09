import { AppFeature } from '@/app/lib/features';
import { auth } from '@/app/lib/auth';
import { HttpStatus } from '@/app/lib/http-status';
import { ApiErrorCode } from '@/app/lib/api-errors';
import { requireSameUser } from '@/app/lib/authorization';
import { assetProxyUrl } from '@/app/lib/asset-proxy';
import { AzuriteBlobAdapter } from '@/app/lib/azure-blob-storage';
import connectDB from '@/app/lib/connect-db';
import { hashPassword } from '@/app/lib/password-hashing';
import { normalizeLocale, type SupportedLocale } from '@/app/lib/i18n/locales';
import { withObservability } from '@/app/lib/observability';
import { passwordChange } from '@/app/lib/validations';
import { env } from '@/app/lib/env';
import UsersDB from '@/app/models/users';
import type { Session } from 'next-auth';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { done, fail } from '@/app/lib/api-response';

type ProfileFormInput = {
  username: string;
  userEmail: string;
  password?: string;
  confirmPassword?: string;
  profileImage: File | null;
  userId: string;
  currentUserName: string;
  currentUserEmail: string;
  language: SupportedLocale;
  currentLanguage: SupportedLocale;
};

function parseProfileFormData(formData: FormData): ProfileFormInput {
  return {
    username: formData.get('username') as string,
    userEmail: formData.get('userEmail') as string,
    password: formData.get('password') as string | undefined,
    confirmPassword: formData.get('confirmPassword') as string | undefined,
    profileImage: formData.get('profileImage') as File | null,
    userId: formData.get('userId') as string,
    currentUserName: formData.get('currentUserName') as string,
    currentUserEmail: formData.get('currentUserEmail') as string,
    // Unsupported values collapse to the default locale, so the enum on the
    // Users schema can never reject the write.
    language: normalizeLocale(formData.get('language')),
    currentLanguage: normalizeLocale(formData.get('currentLanguage')),
  };
}

function hasNoProfileChanges(input: ProfileFormInput): boolean {
  return (
    input.userEmail === input.currentUserEmail &&
    input.username === input.currentUserName &&
    input.language === input.currentLanguage &&
    (!input.profileImage || input.profileImage.size === 0) &&
    !input.password
  );
}

async function applyPasswordIfProvided(
  updateFields: Record<string, unknown>,
  input: ProfileFormInput,
): Promise<{ ok: true } | { ok: false }> {
  if (!input.password || input.password.trim() === '') return { ok: true };
  const parsedPassword = passwordChange.safeParse({
    newPassword: input.password,
    confirmPassword: input.confirmPassword ?? '',
  });
  if (!parsedPassword.success) {
    return { ok: false };
  }
  updateFields.password = await hashPassword(parsedPassword.data.newPassword);
  updateFields.mustChangePassword = false;
  return { ok: true };
}

async function applyProfileImageIfProvided(
  updateFields: Record<string, unknown>,
  profileImage: File | null,
) {
  if (!profileImage || profileImage.size <= 0) return;
  const azureBlob = new AzuriteBlobAdapter(env.APP_SYSTEM_ASSETS_CONTAINER);
  const generatedId = uuidv4();
  const imageFileName = `image_${generatedId}.jpeg`;
  const buffer = Buffer.from(await profileImage.arrayBuffer());
  const blobPath = await azureBlob.uploadFile(buffer, imageFileName);
  updateFields.urlString = assetProxyUrl(blobPath);
}

function invalidUserId(userId: string | undefined) {
  return !userId || !mongoose.Types.ObjectId.isValid(userId);
}

async function ensureUniqueEmailIfChanged(userEmail: string, currentUserEmail: string) {
  if (userEmail === currentUserEmail) return true;
  const existingEmail = await UsersDB.findOne({ email: userEmail });
  return !existingEmail;
}

function buildBaseProfileUpdate(input: ProfileFormInput) {
  const updateFields: Record<string, unknown> = {};
  if (input.username !== input.currentUserName) updateFields.name = input.username;
  if (input.userEmail !== input.currentUserEmail) updateFields.email = input.userEmail;
  if (input.language !== input.currentLanguage) updateFields.language = input.language;
  return updateFields;
}

async function updateProfile(req: Request, session: Session) {
  // Using formData() instead of json() because of image upload.
  const input = parseProfileFormData(await req.formData());
  const { userEmail, userId, currentUserEmail, profileImage } = input;

  if (invalidUserId(userId)) {
    return fail(ApiErrorCode.INVALID_INPUT, HttpStatus.BAD_REQUEST);
  }
  await requireSameUser(session, userId);

  if (hasNoProfileChanges(input)) {
    return done({}, HttpStatus.OK);
  }

  await connectDB();

  const uniqueEmail = await ensureUniqueEmailIfChanged(userEmail, currentUserEmail);
  if (!uniqueEmail) {
    return fail(ApiErrorCode.CONFLICT, HttpStatus.CONFLICT);
  }

  const updateFields = buildBaseProfileUpdate(input);
  const passwordResult = await applyPasswordIfProvided(updateFields, input);
  if (!passwordResult.ok) {
    return fail(ApiErrorCode.INVALID_INPUT, HttpStatus.BAD_REQUEST);
  }

  await applyProfileImageIfProvided(updateFields, profileImage);

  if (Object.keys(updateFields).length === 0) {
    return done({}, HttpStatus.OK);
  }

  const result = await UsersDB.updateOne(
    { _id: new mongoose.Types.ObjectId(`${userId}`) },
    { $set: updateFields },
  );

  if (result.matchedCount === 0) {
    return fail(ApiErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
  }

  return done({}, HttpStatus.OK);
}

export const POST = withObservability<{}>(
  AppFeature.USERS_UPDATE_PROFILE,
  async (req, _ctx, { log }) => {
    const session = await auth();
    if (!session) return fail(ApiErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED);

    try {
      return await updateProfile(req, session);
    } catch (err) {
      log.error({ err }, 'profile update failed');
      return fail(ApiErrorCode.INTERNAL_SERVER_ERROR, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  },
);
