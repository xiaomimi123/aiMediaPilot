'use client';
import { Menu } from 'lucide-react';

interface Props {
  onToggleNav?: () => void;
}

export function Header({ onToggleNav }: Props) {
  return (
    <header className="flex h-14 items-center border-b bg-background px-4 md:hidden md:px-6">
      <button
        type="button"
        onClick={onToggleNav}
        className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="打开菜单"
      >
        <Menu className="h-5 w-5" />
      </button>
    </header>
  );
}
