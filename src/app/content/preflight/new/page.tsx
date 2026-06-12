import { UploadForm } from '@/components/content/upload-form';

export default function NewAnalysisPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">新分析</h1>
      <UploadForm />
    </div>
  );
}
