import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async () => {
  return new Response(
    JSON.stringify({
      success: true,
      message: "보스 푸시 알림 함수가 실행되었습니다.",
    }),
    {
      headers: { "Content-Type": "application/json" },
    },
  );
});
