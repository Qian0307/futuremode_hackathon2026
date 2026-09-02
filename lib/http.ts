/** 從失敗的 Response 取出後端的錯誤訊息（client 端共用）。 */
export async function errorMessage(res: Response, fallback: string): Promise<string> {
  const payload = (await res.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}
