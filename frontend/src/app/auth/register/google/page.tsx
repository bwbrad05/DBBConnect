'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight, GraduationCap, UserRound } from 'lucide-react';

import withAuth from '@/components/with-auth';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/form/text-field';
import { cn } from '@/lib/utils';
import { setToken, setRefreshToken } from '@/lib/cookie';
import useAuthStore from '@/store/use-auth-store';
import api from '@/lib/api';
import { notifyAxiosError, notifySuccess } from '@/lib/toast';
import type { Role } from '@/types/shared';

const schema = z.object({
  phoneNumber: z.string().min(1, 'Nomor telepon wajib diisi'),
  whatsappNumber: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;
type RoleOption = 'STUDENT' | 'TUTOR';

function GoogleRegisterInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const login = useAuthStore.useLogin();
  const [role, setRole] = useState<RoleOption | null>(null);
  const [isPending, setIsPending] = useState(false);

  const code = sp.get('code');

  const methods = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { phoneNumber: '', whatsappNumber: '' },
  });

  if (!code) {
    router.replace('/auth/register');
    return null;
  }

  const onSubmit = methods.handleSubmit(async (values) => {
    if (!role) return;

    setIsPending(true);
    try {
      const res = await api.post<{
        access_token: string;
        refresh_token: string;
        user: { id: string; email: string; name: string; role: Role };
      }>('/auth/google/complete', {
        code,
        role,
        phoneNumber: values.phoneNumber,
        whatsappNumber: role === 'TUTOR' ? values.whatsappNumber : undefined,
      });

      const { access_token, refresh_token, user } = res.data;
      setToken(access_token);
      setRefreshToken(refresh_token);
      login({
        ...user,
        phoneNumber: values.phoneNumber,
        emailVerifiedAt: new Date().toISOString(),
        referralCode: null,
        referredById: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      notifySuccess('Akun berhasil dibuat');
      router.replace(role === 'TUTOR' ? '/tutor' : '/student');
    } catch (err) {
      notifyAxiosError(err, 'Pendaftaran gagal');
    } finally {
      setIsPending(false);
    }
  });

  return (
    <div className='space-y-8'>
      <div className='space-y-2'>
        <h1 className='text-3xl font-semibold tracking-[-0.025em] md:text-4xl'>
          Satu langkah lagi.
        </h1>
        <p className='text-muted-foreground text-sm'>
          Pilih peran dan lengkapi profil Anda untuk memulai.
        </p>
      </div>

      <div className='space-y-3'>
        <button
          type='button'
          onClick={() => setRole('STUDENT')}
          className={cn(
            'group border-primary-100 hover:border-primary-300 from-primary-50/30 hover:shadow-primary-500/5 relative flex w-full items-start gap-4 overflow-hidden rounded-xl border bg-linear-to-br to-white p-5 text-left transition-all hover:shadow-md',
            role === 'STUDENT' && 'border-primary-400 ring-primary-200 ring-2',
          )}
        >
          <div className='border-primary-200 bg-primary-100 text-primary-700 flex size-12 shrink-0 items-center justify-center rounded-xl border'>
            <UserRound className='size-5' strokeWidth={2} />
          </div>
          <div className='flex-1'>
            <div className='flex items-baseline gap-2'>
              <span className='text-base font-semibold'>Siswa</span>
              <span className='text-muted-foreground text-xs'>· Gratis</span>
            </div>
            <p className='text-muted-foreground mt-0.5 text-sm leading-relaxed'>
              Cari tutor, ajukan aplikasi, pesan sesi, dan akses materi.
            </p>
          </div>
          <ArrowRight
            className={cn(
              'text-muted-foreground size-4 self-center transition-colors',
              role === 'STUDENT' && 'text-primary-700',
            )}
          />
        </button>

        <button
          type='button'
          onClick={() => setRole('TUTOR')}
          className={cn(
            'group border-primary-100 hover:border-secondary-300 from-secondary-50/40 hover:shadow-secondary-500/5 relative flex w-full items-start gap-4 overflow-hidden rounded-xl border bg-linear-to-br to-white p-5 text-left transition-all hover:shadow-md',
            role === 'TUTOR' && 'border-secondary-400 ring-secondary-200 ring-2',
          )}
        >
          <div className='border-secondary-200 bg-secondary-100 text-secondary-700 flex size-12 shrink-0 items-center justify-center rounded-xl border'>
            <GraduationCap className='size-5' strokeWidth={2} />
          </div>
          <div className='flex-1'>
            <div className='flex items-baseline gap-2'>
              <span className='text-base font-semibold'>Tutor</span>
              <span className='text-secondary-700 bg-secondary-100 border-secondary-200 rounded-full border px-1.5 py-0.5 text-[10px] font-medium'>
                Perlu verifikasi
              </span>
            </div>
            <p className='text-muted-foreground mt-0.5 text-sm leading-relaxed'>
              Bagikan keahlian, atur jadwal, dan terima pembayaran transparan.
            </p>
          </div>
          <ArrowRight
            className={cn(
              'text-muted-foreground size-4 self-center transition-colors',
              role === 'TUTOR' && 'text-secondary-700',
            )}
          />
        </button>
      </div>

      {role && (
        <FormProvider {...methods}>
          <form onSubmit={onSubmit} className='space-y-4'>
            <TextField<FormValues>
              name='phoneNumber'
              label='Nomor telepon'
              placeholder='08xxxxxxxxxx'
            />
            {role === 'TUTOR' && (
              <TextField<FormValues>
                name='whatsappNumber'
                label='Nomor WhatsApp'
                placeholder='08xxxxxxxxxx'
              />
            )}
            <Button
              type='submit'
              size='lg'
              className='w-full'
              disabled={isPending}
            >
              {isPending ? 'Memuat...' : 'Mulai sekarang'}
            </Button>
          </form>
        </FormProvider>
      )}
    </div>
  );
}

function GoogleRegisterPage() {
  return (
    <Suspense
      fallback={
        <div className='flex min-h-[60vh] items-center justify-center'>
          <p className='text-muted-foreground text-sm'>Memuat...</p>
        </div>
      }
    >
      <GoogleRegisterInner />
    </Suspense>
  );
}

export default withAuth(GoogleRegisterPage, 'optional');
