import { NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** 統一的輸入驗證：解析 JSON body 並用 Zod 驗證。 */
export async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<{ data: T } | { response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { response: fail("請求內容不是合法的 JSON", 400) };
  }
  try {
    return { data: schema.parse(raw) };
  } catch (err) {
    if (err instanceof ZodError) {
      return { response: fail("輸入格式不正確", 422, { issues: err.issues.map((i) => ({ path: i.path, message: i.message })) }) };
    }
    return { response: fail("輸入驗證失敗", 422) };
  }
}
