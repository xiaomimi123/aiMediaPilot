import Link from 'next/link';

export function SettingsBack() {
  return (
    <Link
      href="/settings"
      className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
    >
      回设置
    </Link>
  );
}
