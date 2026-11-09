import { auth } from '@/app/lib/auth';
import { redirect } from 'next/navigation';
import ChangePasswordForm from './change-password-form';

export default async function ChangePasswordPage() {
  const session = await auth();

  if (!session) {
    return redirect('/login');
  }

  // Already changed — no reason to stay on this page
  if (!session.user?.mustChangePassword) {
    return redirect('/');
  }

  return <ChangePasswordForm userEmail={session.user?.email ?? ''} />;
}
