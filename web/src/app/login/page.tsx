'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { login } from '@/server/auth';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    const res = await login(password);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const next = searchParams.get('next') ?? '/staff?floor=1F';
    router.push(next);
    router.refresh();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={e => void handleSubmit(e)} className="bg-white rounded-2xl shadow-lg p-8 w-[360px]">
        <h1 className="text-lg font-bold text-slate-800 mb-1">シフト管理</h1>
        <p className="text-xs text-slate-500 mb-5">パスワードを入力してください</p>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoFocus
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm mb-3 focus:border-blue-400 outline-none"
          placeholder="パスワード"
        />
        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !password}
          className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? '確認中...' : 'ログイン'}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
