import { NextResponse } from 'next/server';

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  pagination?: { page: number; pageSize: number; total: number };
};

export function ok<T>(data: T, message = 'ok') {
  return NextResponse.json<ApiResponse<T>>({ success: true, data, message });
}

export function fail(message: string, status = 400) {
  return NextResponse.json<ApiResponse<never>>(
    { success: false, message },
    { status }
  );
}
