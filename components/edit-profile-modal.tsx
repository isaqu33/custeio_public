'use client';

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import { setAppLocaleCookie } from '@/app/lib/i18n/locale-cookie';
import {
  LOCALE_LABELS,
  normalizeLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@/app/lib/i18n/locales';
import { showApiErrorToast, showErrorToast, showSuccessToast } from '@/app/lib/toast';
import { cn } from '@/app/lib/utils';

import { zodResolver } from '@hookform/resolvers/zod';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';

import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Check,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Trash2,
  Upload,
  User,
  UserCircleIcon,
  UsersIcon,
  X,
} from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import { Separator } from '@/components/ui/separator';
import { createProfileFormSchema, type ProfileFormValues } from './edit-profile-modal/schema';

interface userType {
  email: string | undefined;
  image: string | undefined;
  name: string;
  _id: string | undefined;
  language?: SupportedLocale;
}

export function EditProfileModal({
  userInfo,
  setCloseDropdownMenu,
  setRefetchData,
}: {
  userInfo: userType;
  setCloseDropdownMenu: (_prop: boolean) => void;
  setRefetchData: (_prop: boolean) => void;
}) {
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [selectedProfile, _setSelectedProfile] = useState<userType>(userInfo);
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [ImageFile, setImageFile] = useState<File | null>();

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const copy = useCopy();
  const router = useRouter();
  const { update: updateSession } = useSession();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => setProfileImage(e.target?.result as string);
    reader.readAsDataURL(file);
    setImageFile(file);
  }, []);

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    open: openFilePicker,
  } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    maxFiles: 1,
    maxSize: 5 * 1024 * 1024, // 5 MB — before the existing browser-image-compression pass
    multiple: false,
    noClick: true, // The explicit "Upload" button opens the picker via openFilePicker()
    noKeyboard: true,
    onDropRejected: (_rejections) => {
      showErrorToast();
    },
  });
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(createProfileFormSchema(copy)),
    defaultValues: {
      username: selectedProfile.name,
      userEmail: selectedProfile.email,
      password: '',
      confirmPassword: '',
      language: normalizeLocale(selectedProfile.language),
    },
  });

  const handleSubmit = async (values: ProfileFormValues) => {
    const formData = new FormData();
    formData.append('username', values.username);
    formData.append('userEmail', values.userEmail);
    if (values.password) {
      formData.append('password', values.password);
    }
    if (values.confirmPassword) {
      formData.append('confirmPassword', values.confirmPassword);
    }
    formData.append('language', values.language);
    if (ImageFile) {
      formData.append('profileImage', ImageFile);
    }
    formData.append('userId', userInfo._id || '');
    formData.append('currentUserName', userInfo.name);
    formData.append('currentUserEmail', userInfo.email || '');
    formData.append('currentLanguage', normalizeLocale(userInfo.language));

    try {
      setIsLoading(true);
      // apiFetch passes FormData through untouched (the browser sets
      // Content-Type: multipart/form-data with the right boundary).
      const result = await apiFetch<{ done: boolean; message?: string }>(
        endpointFor(AppFeature.USERS_UPDATE_PROFILE),
        { method: 'POST', body: formData },
      );
      if (result.done) {
        // The cookie lands immediately so the next server render already uses
        // the new locale; the session update keeps the JWT in step.
        setAppLocaleCookie(values.language);
        await updateSession({ language: values.language });
        showSuccessToast();
        setRefetchData(true);
        setCloseDropdownMenu(false);
        router.refresh();
      } else {
        showErrorToast();
      }
    } catch (error) {
      if (error instanceof ApiError) {
        showApiErrorToast(error);
        return;
      }
      showErrorToast();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog
      open={isProfileModalOpen}
      onOpenChange={(context) => {
        setIsProfileModalOpen(context);
        if (context === false) {
          setCloseDropdownMenu(false);
        }
      }}
    >
      <DialogTrigger asChild className=" w-full items-center">
        <Button variant="ghost" className=" justify-start p-0 pl-2 ">
          <UserCircleIcon />
          {copy.account.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent
        className=" max-h-[90vh] max-w-2xl overflow-y-auto"
        aria-describedby="modalProfileUser"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2 text-xl">
            <User className="size-6 " />
            <span>{copy.account.title}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <p className=" text-sm">{copy.account.description}</p>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-8">
              {/* Profile Image Section — drag-and-drop or click to upload */}
              <Card
                {...getRootProps()}
                className={cn(
                  'transition-colors',
                  isDragActive && 'border-2 border-dashed border-primary bg-primary/5',
                )}
              >
                <CardContent className="p-6">
                  <input {...getInputProps()} data-testid="profile-photo-input" />
                  <div className="flex flex-col items-center space-y-4">
                    <div className="relative">
                      <Avatar className="size-32 border-4">
                        <AvatarImage
                          src={profileImage || selectedProfile?.image}
                          alt={copy.account.profileImageAlt}
                        />
                        <AvatarFallback className="bg-gradient-to-br  text-2xl">
                          {selectedProfile?.name
                            .split(' ')
                            .map((n: string) => n[0])
                            .join('')
                            .slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      {profileImage && (
                        <Button
                          variant="destructive"
                          size="sm"
                          type="button"
                          className="absolute -right-2 -top-2 size-8 rounded-full p-0"
                          onClick={() => {
                            setProfileImage(null);
                            setImageFile(null);
                          }}
                        >
                          <X className="size-4" />
                        </Button>
                      )}
                    </div>

                    <div className="text-center">
                      <h3 className="mb-1  font-semibold">{copy.account.profilePhoto}</h3>
                      <p className=" mb-4 text-sm">
                        {isDragActive
                          ? copy.account.profilePhotoDropActive
                          : copy.account.profilePhotoHint}
                      </p>
                    </div>

                    <div className="flex flex-wrap justify-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openFilePicker()}
                        type="button"
                      >
                        <Upload className="mr-2 size-4" />
                        {copy.account.uploadPhoto}
                      </Button>
                      {profileImage && (
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          onClick={() => {
                            setProfileImage(null);
                            setImageFile(null);
                          }}
                          className="border-red-600 text-red-400 hover:bg-red-600/10"
                        >
                          <Trash2 className="mr-2 size-4" />
                          {copy.account.removePhoto}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Separator className="" />

              {/* Enhanced Form Fields */}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {/* Personal Information */}
                <Card className="">
                  <CardContent className="p-4">
                    <h3 className="mb-4  flex items-center font-semibold">
                      <User className="mr-2 size-4 " />
                      {copy.account.personalInformation}
                    </h3>
                    <div className="space-y-4">
                      {/* Name */}
                      <FormField
                        control={form.control}
                        name="username"
                        render={({ field }) => (
                          <FormItem className="grid gap-2">
                            <FormLabel className=" font-medium">{copy.account.name}</FormLabel>
                            <div className="relative">
                              <UsersIcon className="absolute left-3 top-2 h-5 w-4 text-gray-400" />
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder={copy.account.namePlaceholder}
                                  type="text"
                                  className="pl-10"
                                />
                              </FormControl>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Email */}
                      <FormField
                        control={form.control}
                        name="userEmail"
                        render={({ field }) => (
                          <FormItem className="grid gap-2">
                            <FormLabel>{copy.account.email}</FormLabel>
                            <div className="relative">
                              <Mail className="absolute left-3 top-2 h-5 w-4 text-gray-400" />
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder={copy.account.emailPlaceholder}
                                  type="email"
                                  className="pl-10"
                                />
                              </FormControl>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Language */}
                      <FormField
                        control={form.control}
                        name="language"
                        render={({ field }) => (
                          <FormItem className="grid gap-2">
                            <FormLabel>{copy.account.language}</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger aria-label={copy.account.language}>
                                  <SelectValue placeholder={copy.account.languagePlaceholder} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {[...SUPPORTED_LOCALES]
                                  .sort((left, right) =>
                                    LOCALE_LABELS[left].localeCompare(LOCALE_LABELS[right]),
                                  )
                                  .map((locale) => (
                                    <SelectItem key={locale} value={locale}>
                                      {LOCALE_LABELS[locale]}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Account Information */}
                <Card className="">
                  <CardContent className="p-4">
                    <h3 className="mb-4  flex items-center font-semibold">
                      <ShieldCheck className="mr-2 size-4" />
                      {copy.account.securitySettings}
                    </h3>
                    <div className="space-y-4">
                      {/* Password */}
                      <FormField
                        control={form.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem className="grid gap-2">
                            <FormLabel>{copy.account.password}</FormLabel>
                            <div className="relative">
                              <Lock className="absolute left-3 top-2 h-5 w-4 text-gray-400" />
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder={copy.account.passwordPlaceholder}
                                  type={showPassword ? 'text' : 'password'}
                                  className="px-10"
                                />
                              </FormControl>
                              <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                              >
                                {showPassword ? (
                                  <EyeOff className="size-4" />
                                ) : (
                                  <Eye className="size-4" />
                                )}
                              </button>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="confirmPassword"
                        render={({ field }) => (
                          <FormItem className="grid gap-2">
                            <FormLabel>{copy.account.confirmPassword}</FormLabel>
                            <div className="relative">
                              <Lock className="absolute left-3 top-2 h-5 w-4 text-gray-400" />
                              <FormControl>
                                <Input
                                  {...field}
                                  id="confirmPassword"
                                  name="confirmPassword"
                                  type={showConfirmPassword ? 'text' : 'password'}
                                  placeholder={copy.account.confirmPasswordPlaceholder}
                                  className="px-10"
                                />
                              </FormControl>
                              <button
                                type="button"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                              >
                                {showConfirmPassword ? (
                                  <EyeOff className="size-4" />
                                ) : (
                                  <Eye className="size-4" />
                                )}
                              </button>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between border-t pt-4 ">
                <div className="flex space-x-3">
                  <Button type="submit" disabled={isLoading}>
                    {isLoading ? (
                      <div className="mr-2 size-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                    ) : (
                      <Check className="mr-2 size-4" />
                    )}
                    {copy.common.saveChanges}
                  </Button>
                </div>
              </div>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
