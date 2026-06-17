'use client';
import { Menu } from 'lucide-react';

interface Props {
  onToggleNav?: () => void;
}

export function Header({ onToggleNav }: Props) {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-4 md:px-6">
      <button
        type="button"
        onClick={onToggleNav}
        className="rounded p-1 text-muted-foreground hover:text-foreground md:hidden"
        aria-label="打开菜单"
      >
        <Menu className="h-5 w-5" />
      </button>
      <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
        <span>单用户 MVP</span>
      </div>
    </header>
  );
}
