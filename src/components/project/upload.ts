/** 用 XHR 上传(fetch 拿不到上传进度)。请求体直接是文件, 服务端流式写盘。 */
export function uploadVideo(
  projectId: string,
  file: File,
  onProgress: (ratio: number) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/projects/${projectId}/upload`);
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: { success?: boolean; message?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // 非 JSON 响应按失败处理
      }
      resolve(body.success ? { ok: true } : { ok: false, message: body.message ?? `上传失败（${xhr.status}）` });
    };
    xhr.onerror = () => resolve({ ok: false, message: '网络断了，上传没完成。重新拖进来再传一次。' });
    xhr.send(file);
  });
}
