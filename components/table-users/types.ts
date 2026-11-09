/** Only what the row actions need from `useRouter()`, so they are testable. */
export type RouterLike = {
  refresh: () => void;
};

export type User = {
  _id: string;
  organizationIds: string[];
  name: string;
  email: string;
  organizationNames: string;
  hasSystemAccess: boolean;
  disabled: boolean;
  lastSignInAt?: string;
};
