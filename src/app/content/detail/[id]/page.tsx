import { ContentDetailClient } from "@/components/cockpit/content-detail-client";

export default async function ContentDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return <ContentDetailClient id={id} />;
}
