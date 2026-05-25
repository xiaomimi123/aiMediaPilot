'use client';
import { useRouter } from 'next/navigation';
import { Wizard } from '@/components/binding/wizard';
import { StepPlatform } from '@/components/binding/step-platform';
import { StepProxy } from '@/components/binding/step-proxy';
import { StepLogin } from '@/components/binding/step-login';
import { StepComplete } from '@/components/binding/step-complete';

export default function BindAccountPage() {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-5xl">
      <Wizard>
        {({ step, state, update, next, prev }) => {
          if (step === 0) {
            return (
              <StepPlatform
                selected={state.platform}
                onSelect={(id) => update({ platform: id })}
                onNext={() => next()}
              />
            );
          }
          if (step === 1) {
            return (
              <StepProxy
                onBack={prev}
                onNext={async (proxy) => {
                  const res = await fetch('/api/v1/accounts/bind-session', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ platform: state.platform, proxy }),
                  });
                  const json = await res.json();
                  if (!json.success) { alert(json.message); return; }
                  next({ proxy, sessionId: json.data.sessionId, vncUrl: json.data.vncUrl });
                }}
              />
            );
          }
          if (step === 2 && state.sessionId && state.vncUrl) {
            return (
              <StepLogin
                sessionId={state.sessionId}
                vncUrl={state.vncUrl}
                onLoggedIn={(accountId) => next({ accountId })}
                onCancel={() => router.push('/accounts')}
              />
            );
          }
          if (step === 3 && state.accountId) {
            return <StepComplete accountId={state.accountId} />;
          }
          return <p>状态异常,请重试</p>;
        }}
      </Wizard>
    </div>
  );
}
