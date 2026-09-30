import { z } from "zod";
import { pcStatusSchema, type PcStatus } from "../../shared/pc";

const errorResponseSchema = z.object({ error: z.string() });

async function readPcResponse(response: Response): Promise<PcStatus> {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(
      "管理画面の応答を確認できません。Cloudflare Accessに再ログインするため、ページを再読み込みしてください。",
    );
  }
  const body: unknown = await response.json();
  if (!response.ok) {
    const result = errorResponseSchema.safeParse(body);
    throw new Error(
      result.success ? result.data.error : "通信に失敗しました。再確認してください。",
    );
  }
  const result = pcStatusSchema.safeParse(body);
  if (!result.success) throw new Error("PC状態の応答が不正です。ページを再読み込みしてください。");
  return result.data;
}

export async function fetchPcStatus(signal: AbortSignal): Promise<PcStatus> {
  const response = await fetch("/api/pc", {
    signal,
    credentials: "same-origin",
    cache: "no-store",
  });
  return readPcResponse(response);
}

export async function wakePc(): Promise<PcStatus> {
  const response = await fetch("/api/pc/wake", { method: "POST", credentials: "same-origin" });
  return readPcResponse(response);
}
