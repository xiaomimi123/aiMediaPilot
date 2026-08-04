'use client';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ExternalShell } from '@/components/cockpit/external-shell';

export function MainLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname === '/') return <>{children}</>;

  return <ExternalShell>{children}</ExternalShell>;
}
