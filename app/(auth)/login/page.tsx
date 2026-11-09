import SignIn from '@/components/sign-in';
import { CusteioLogo } from '@/components/custeio-logo';

export default function LoginPage() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex items-center">
          <CusteioLogo className="h-16 w-auto max-w-full text-foreground lg:h-20" />
        </div>
        <SignIn />
      </div>
    </div>
  );
}
