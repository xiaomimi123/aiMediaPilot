import { NextResponse } from 'next/server';

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  pagination?: { page: number; pageSize: number; total: number };
  /**
   * 三十一期 Task 2: 结构化错误文案数组——FilmPlan 校验失败(schema 外字段/
   * 时间轴留空档)时, 前端(剪辑台)与模型修复循环用同一套人读的字符串,
   * 不再各自拼一份措辞不同的报错(见 film-plan-timing.ts / film-plan-builder.ts
   * 顶部关于"错误信息是契约"的注释)。
   */
  errors?: string[];
};

export function ok<T>(data: T, message = 'ok') {
  return NextResponse.json<ApiResponse<T>>({ success: true, data, message });
}

/** `extra`: 目前只用于携带 `errors` 数组, 其余调用点不传就是历史行为不变。 */
export function fail(message: string, status = 400, extra?: { errors?: string[] }) {
  return NextResponse.json<ApiResponse<never>>(
    { success: false, message, ...extra },
    { status }
  );
}
