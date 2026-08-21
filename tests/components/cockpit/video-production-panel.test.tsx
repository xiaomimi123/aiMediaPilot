// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// 十九期 T15 code review 修复: talking-head-broll 的"开始生成"前置校验必须看
// vp.status 而不是"vp 是否存在"——handleUploadSourceVideo 会先创建/复用一条
// VideoProduction 记录, 再发 multipart 上传; 如果上传本身失败, 记录已经落库
// (status 停在创建时的 'queued') 但 sourceVideoPath 仍是空, 且不会入队(入队只
// 发生在上传成功之后)。这里用 mock fetch 模拟 latest 接口分别返回
// null/{status:'queued'}/{status:'source_uploaded'} 三种情况, 断言只有真正
// 上传成功过 (status 不是 'queued') 才会跳过"请先上传"的兜底态。

import { VideoProductionPanel } from "@/components/cockpit/video-production-panel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockLatest(data: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/latest")) {
      return { json: async () => ({ success: true, data }) } as Response;
    }
    return { json: async () => ({ success: true, data }) } as Response;
  }));
}

describe("VideoProductionPanel — talking-head-broll 前置校验", () => {
  it("latest 查无记录(从未创建/从未上传) → 禁用开始生成, 提示先去录制步骤上传", async () => {
    mockLatest(null);
    render(<VideoProductionPanel contentId="c1" deliveryMode="talking-head-broll" />);
    const button = await screen.findByRole("button", { name: "开始生成" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/请先在「录制」步骤上传出镜视频/)).toBeTruthy();
  });

  it("latest 查到记录但 status 仍是 queued(创建成功但上传失败) → 依然是禁用态, 不会误判成正常排队中", async () => {
    mockLatest({ id: "vp1", status: "queued", previewPath: null, masterPath: null, errorMessage: null });
    render(<VideoProductionPanel contentId="c1" deliveryMode="talking-head-broll" />);
    const button = await screen.findByRole("button", { name: "开始生成" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    // 明确提示"没上传成功", 不能只显示笼统的「排队中」让用户误以为一切正常
    expect(screen.getByText(/出镜视频还没有上传成功/)).toBeTruthy();
    expect(screen.queryByText("排队中")).toBeNull();
  });

  it("latest 查到 status=source_uploaded(真正上传成功过) → 不再拦截, 正常显示状态文案", async () => {
    mockLatest({ id: "vp1", status: "source_uploaded", previewPath: null, masterPath: null, errorMessage: null });
    render(<VideoProductionPanel contentId="c1" deliveryMode="talking-head-broll" />);
    await waitFor(() => expect(screen.getByText("视频已上传，等待生成")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "开始生成" })).toBeNull();
  });
});
