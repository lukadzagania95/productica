import { requireChatGPTUser } from "./chatgpt-auth";
import Productica from "./productica";
export const dynamic = "force-dynamic";
export default async function Home() {
  await requireChatGPTUser("/");
  return <Productica />;
}
