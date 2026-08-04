'use client';
import dynamic from 'next/dynamic';
const Cockpit = dynamic(() => import('@/components/cockpit/Cockpit'), { ssr: false });
export default function Home() { return <Cockpit />; }
