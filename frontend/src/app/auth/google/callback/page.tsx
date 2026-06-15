'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import api from '@/lib/api';
import { setToken, setRefreshToken } from '@/lib/cookie';
import useAuthStore from '@/store/use-auth-store';
import type { Role } from '@/types/shared';

function GoogleCallbackInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const login = useAuthStore.useLogin();

  useEffect(() => {
    const code = sp.get('code');
    if (!code) {
      router.replace('/auth/login');
      return;
    }

    api
      .post<{
        access_token: string;
        refresh_token: string;
        user: { id: string; email: string; name: string; role: Role };
      }>('/auth/google/exchange', { code })
      .then((res) => {
        const { access_token, refresh_token, user } = res.data;
        setToken(access_token);
        setRefreshToken(refresh_token);
        login({
          ...user,
          phoneNumber: '',
          emailVerifiedAt: new Date().toISOString(),
          referralCode: null,
          referredById: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        const target =
          user.role === 'TUTOR'
            ? '/tutor'
            : user.role === 'STUDENT'
              ? '/student'
              : '/admin';
        router.replace(target);
      })
      .catch(() => router.replace('/auth/login'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className='flex min-h-[60vh] items-center justify-center'>
      <p className='text-muted-foreground text-sm'>Memproses login Google...</p>
    </div>
  );
}

export default function GoogleCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className='flex min-h-[60vh] items-center justify-center'>
          <p className='text-muted-foreground text-sm'>Memproses login Google...</p>
        </div>
      }
    >
      <GoogleCallbackInner />
    </Suspense>
  );
}
