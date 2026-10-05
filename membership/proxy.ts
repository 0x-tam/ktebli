import { auth } from "@/lib/auth/server";
import type { NextRequest } from "next/server";
export default function proxy(request: NextRequest) {
  return auth().middleware({ loginUrl: "/account/auth" })(request);
}
export const config = { matcher: ["/dashboard/:path*"] };
