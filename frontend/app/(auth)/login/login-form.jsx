"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { toast } from "sonner";

import GoogleSignInButton from "@/components/auth/google-sign-in-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Divider } from "@/components/ui/misc";
import { authApi } from "@/lib/endpoints";
import { loginSchema } from "@/lib/validators";
import { useSession } from "@/store/use-session";

function safeNext(value) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  if (value === "/login" || value === "/register" || value.startsWith("/login?")) {
    return "/dashboard";
  }
  return value;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setSession = useSession((state) => state.setSession);
  const status = useSession((state) => state.status);
  const [showPassword, setShowPassword] = useState(false);
  const next = safeNext(searchParams.get("next"));

  useEffect(() => {
    if (status === "authed") router.replace(next);
  }, [status, router, next]);

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values) => {
    try {
      const data = await authApi.login(values);
      setSession(data);
      toast.success("Welcome back", {
        description: "Your terminal is ready.",
      });
      router.replace(next);
    } catch (error) {
      if (error?.code === "VALIDATION_ERROR" && Array.isArray(error.details)) {
        error.details.forEach((detail) => {
          const field = detail.path?.[0];
          if (field === "email" || field === "password") {
            setError(field, { message: detail.message });
          }
        });
      }
      setError("root", {
        message: error?.message || "Unable to sign in. Try again.",
      });
    }
  };

  const fillDemo = () => {
    setValue("email", "trader1@stox.com");
    setValue("password", "Password1!");
  };

  return (
    <div className="animate-rise">
      <div className="mb-7">
        <p className="eyebrow mb-2.5">Welcome back</p>
        <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.035em] text-fg">
          Sign in to Stox
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">
          Pick up where you left off. Your portfolios and orders are waiting.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {errors.root?.message ? (
          <Alert tone="danger" title="Sign-in failed">
            {errors.root.message}
          </Alert>
        ) : null}

        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          {({ id }) => (
            <Input
              id={id}
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              leftIcon={<Mail className="size-4" aria-hidden="true" />}
              invalid={Boolean(errors.email)}
              {...register("email")}
            />
          )}
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          error={errors.password?.message}
        >
          {({ id }) => (
            <Input
              id={id}
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Your password"
              leftIcon={<LockKeyhole className="size-4" aria-hidden="true" />}
              invalid={Boolean(errors.password)}
              rightSlot={
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="flex size-7 items-center justify-center rounded-[6px] text-fg-subtle transition-colors hover:text-fg"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              }
              {...register("password")}
            />
          )}
        </Field>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={isSubmitting}
          rightIcon={<ArrowRight className="size-4" aria-hidden="true" />}
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>

        {process.env.NODE_ENV !== "production" ? (
          <button
            type="button"
            onClick={fillDemo}
            className="w-full text-center text-[11.5px] text-fg-subtle transition-colors hover:text-brand"
          >
            Use local demo account · trader1@stox.com
          </button>
        ) : null}
      </form>

      <Divider label="or" className="my-5" />

      <GoogleSignInButton
        onSuccess={(data) => {
          setSession(data);
          toast.success("Signed in with Google");
          router.replace(next);
        }}
        onError={(error) =>
          setError("root", {
            message: error?.message || "Google authentication failed.",
          })
        }
      />

      <p className="mt-7 text-center text-[12.5px] text-fg-muted">
        New to Stox?{" "}
        <Link
          href="/register"
          className="font-medium text-brand transition-colors hover:text-brand-strong"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
