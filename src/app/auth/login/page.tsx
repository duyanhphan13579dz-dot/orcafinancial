import { Suspense } from "react";
import LoginForm from "./login-form";

function LoginLoading() {
  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md panel p-8">
        <div className="text-center">
          <div className="h-12 w-12 rounded bg-gradient-to-br from-[#00d4ff] to-[#0073a8] flex items-center justify-center text-2xl mx-auto mb-4">
            🐋
          </div>

          <div className="h-6 w-32 bg-slate-700/50 rounded mx-auto animate-pulse" />

          <div className="h-4 w-48 bg-slate-700/30 rounded mx-auto mt-3 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginLoading />}>
      <LoginForm />
    </Suspense>
  );
}
