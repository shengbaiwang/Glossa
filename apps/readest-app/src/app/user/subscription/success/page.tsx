'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Retain old URLs without contacting the upstream payment or storage service. */
export default function SubscriptionSuccessPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/user');
  }, [router]);
  return null;
}
