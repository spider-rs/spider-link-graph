"use client";

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Auth } from "@supabase/auth-ui-react";
import { buttonVariants } from "@/components/ui/button";
import { createClient, Session } from "@supabase/supabase-js";
import cookie from "cookie";

enum CookieKeys {
  ACCESS_TOKEN = "supabase/access_token",
  REFRESH_TOKEN = "supabase/refresh_token",
}

const expireAuthCookies = () => {
  const date = new Date();
  date.setDate(date.getDate() - 2);
  document.cookie = cookie.serialize(CookieKeys.ACCESS_TOKEN, "", { expires: date });
  document.cookie = cookie.serialize(CookieKeys.REFRESH_TOKEN, "", { expires: date });
};

const windowExist = typeof window !== "undefined";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder",
  { auth: { persistSession: windowExist, autoRefreshToken: windowExist } }
);

enum Triggers { "register", "login" }

export const useAuthMenu = () => {
  const [trigger, setTrigger] = useState<Triggers>(Triggers.login);
  const [open, setOpen] = useState(false);
  const [$session, setSession] = useState<Session | null>();

  useEffect(() => {
    const { data: { subscription } } = supabase?.auth?.onAuthStateChange(
      async (event, newSession) => {
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") setOpen(false);
        if (event === "SIGNED_OUT") { expireAuthCookies(); setSession(null); return; }
        if (newSession) {
          document.cookie = cookie.serialize(
            CookieKeys.ACCESS_TOKEN, newSession.access_token || "",
            { sameSite: "lax", secure: true, path: "/" }
          );
          document.cookie = cookie.serialize(
            CookieKeys.REFRESH_TOKEN, newSession.refresh_token || "",
            { sameSite: "lax", secure: true, path: "/" }
          );
        }
        setSession(newSession);
      }
    );
    return () => { subscription?.unsubscribe(); };
  }, []);

  return { email: $session?.user.email, open, trigger, setTrigger, setOpen, $session };
};

const AuthDropdown = ({
  setTrigger, setOpen, $session, open, trigger,
}: ReturnType<typeof useAuthMenu>) => {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {$session ? null : (
        <div className="flex gap-2 items-center shrink-0">
          <DialogTrigger
            onClick={() => setTrigger(Triggers.login)}
            className={`${buttonVariants({ variant: "default", size: "sm" })} uppercase font-mono text-xs`}
          >Sign In</DialogTrigger>
          <DialogTrigger
            onClick={() => setTrigger(Triggers.register)}
            className={`${buttonVariants({ variant: "outline", size: "sm" })} uppercase font-mono text-xs border-primary/50`}
          >Register</DialogTrigger>
        </div>
      )}
      <DialogContent className="sm:max-w-[425px]">
        <div className="max-w-screen-sm container text-black dark:text-white pb-10">
          <DialogTitle className="text-center">Spider Link Graph</DialogTitle>
          <DialogDescription className="text-center">Authenticate to start.</DialogDescription>
          <div className="py-4">
            <Auth
              supabaseClient={supabase}
              view={trigger === Triggers.register ? "sign_up" : undefined}
              appearance={{
                extend: false,
                className: {
                  divider: "w-full h-0.5 bg-border my-4",
                  label: "block py-1",
                  container: "grid gap-3",
                  button: "px-3 py-2 rounded border-2 border-border hover:border-primary/50 hover:bg-primary/10 flex gap-2 place-content-center place-items-center",
                  input: "px-3 py-2 rounded border-2 flex-1 w-full bg-transparent",
                  anchor: "text-center underline hover:text-primary",
                  message: "block w-full py-2 text-red-500 text-center",
                },
              }}
              providers={["github", "discord"]}
              redirectTo="https://link-graph.spider.cloud"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AuthDropdown;
