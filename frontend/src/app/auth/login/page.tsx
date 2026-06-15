'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Button } from '@/components/ui/button';
import { TextField } from '@/components/form/text-field';
import withAuth from '@/components/with-auth';
import useAuthStore from '@/store/use-auth-store';
import { notifyAxiosError, notifySuccess } from '@/lib/toast';
import { apiUrl } from '@/constant/env';

import { useLogin } from './hooks/mutation';
import { loginFormSchema } from './schema';
import type { LoginForm, LoginRequest } from './types';

function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const login = useAuthStore.useLogin();

  const methods = useForm<LoginForm>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: '', password: '' },
  });

  const { mutateAsync, isPending } = useLogin();

  const onSubmit = methods.handleSubmit(async (values) => {
    const req: LoginRequest = {
      email: values.email,
      password: values.password,
    };
    try {
      const res = await mutateAsync(req);
      login({
        ...res.user,
        phoneNumber: '',
        emailVerifiedAt: null,
        referralCode: null,
        referredById: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      notifySuccess('Login berhasil');
      const redirectParam =
        sp.get('redirect') ??
        (typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('redirect')
          : null);
      const target =
        redirectParam ??
        (res.user.role === 'TUTOR'
          ? '/tutor'
          : res.user.role === 'STUDENT'
            ? '/student'
            : '/admin');
      router.replace(target);
    } catch (err) {
      notifyAxiosError(err, 'Login gagal');
    }
  });

  return (
    <div className='space-y-8'>
      <div className='space-y-2'>
        <h1 className='text-3xl font-semibold tracking-[-0.025em] md:text-4xl'>
          Selamat datang kembali.
        </h1>
        <p className='text-muted-foreground text-sm'>
          Belum punya akun?{' '}
          <Link
            href='/auth/register'
            className='text-primary-700 hover:text-primary-900 font-medium underline-offset-4 hover:underline'
          >
            Daftar gratis
          </Link>
        </p>
      </div>
      <FormProvider {...methods}>
        <form onSubmit={onSubmit} className='space-y-5'>
          <TextField<LoginForm>
            name='email'
            label='Email'
            type='email'
            autoComplete='email'
            placeholder='you@example.com'
          />
          <div className='space-y-1.5'>
            <TextField<LoginForm>
              name='password'
              label='Password'
              type='password'
              autoComplete='current-password'
              placeholder='••••••••'
            />
            <div className='text-right'>
              <Link
                href='/auth/forgot'
                className='text-muted-foreground hover:text-foreground text-xs'
              >
                Lupa password?
              </Link>
            </div>
          </div>
          <Button
            type='submit'
            size='lg'
            className='w-full gap-1.5'
            disabled={isPending}
          >
            {isPending ? 'Memuat...' : 'Masuk'}
          </Button>
        </form>
      </FormProvider>

      <div className='relative'>
        <div className='absolute inset-0 flex items-center'>
          <span className='border-border w-full border-t' />
        </div>
        <div className='relative flex justify-center text-xs'>
          <span className='bg-background text-muted-foreground px-2'>atau</span>
        </div>
      </div>

      <Button
        type='button'
        variant='outline'
        size='lg'
        className='w-full gap-2.5'
        onClick={() => {
          window.location.href = `${apiUrl}/api/auth/google`;
        }}
      >
        <svg viewBox='0 0 24 24' className='size-4' aria-hidden='true'>
          <path
            d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'
            fill='#4285F4'
          />
          <path
            d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'
            fill='#34A853'
          />
          <path
            d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z'
            fill='#FBBC05'
          />
          <path
            d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z'
            fill='#EA4335'
          />
        </svg>
        Masuk dengan Google
      </Button>

      <p className='text-muted-foreground text-center text-xs'>
        Dengan masuk, Anda menyetujui{' '}
        <Link
          href='/legal/terms'
          className='hover:text-foreground underline-offset-4 hover:underline'
        >
          Syarat Layanan
        </Link>{' '}
        dan{' '}
        <Link
          href='/legal/privacy'
          className='hover:text-foreground underline-offset-4 hover:underline'
        >
          Kebijakan Privasi
        </Link>
        .
      </p>
    </div>
  );
}

export default withAuth(LoginPage, 'public');
