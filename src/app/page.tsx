import { redirect } from 'next/navigation';

/** 根路径没有独立内容 —— 直接进稿库, 那是这个产品当前唯一跑通的能力。 */
export default function Home() {
  redirect('/scripts');
}
