
import { supabase } from "./supabase";

export async function testSupabaseConnection() {
  const { data, error } = await supabase
    .from("bosses")
    .select("id")
    .limit(1);

  if (error) {
    console.error("Supabase 연결 오류:", error.message);
    return false;
  }

  console.log("Supabase 연결 성공!", data);
  return true;
}
