"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";

import GoogleSignInButton from "@/components/auth/google-sign-in-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Divider } from "@/components/ui/misc";
import { authApi } from "@/lib/endpoints";
import { registerSchema } from "@/lib/validators";
import { cn } from "@/lib/utils";
import { useSession } from "@/store/use-session";

const rules = [
  { key: "length", label: "6+ characters", test: (value) => value.length >= 6 },
  { key: "lower", label: "Lowercase", test: (value) => /[a-z]/.test(value) },
  { key: "upper", label: "Uppercase", test: (value) => /[A-Z]/.test(value) },
  { key: "number", label: "Number", test: (value) => /[0-9]/.test(value) },
  {
    key: "symbol",
    label: "Symbol",
    test: (value) => /[^A-Za-z0-9\s]/.test(value),
  },
];

export default function RegisterPage() {
  const router = useRouter();
  const setSession = useSession((state) => state.setSession);
  const status = useSession((state) => state.status);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const password = watch("password") || "";

  useEffect(() => {
    if (status === "authed") router.replace("/dashboard");
  }, [status, router]);

  const onSubmit = async (values) => {
    try {
      const data = await authApi.register({
        name: values.name,
        email: values.email,
        password: values.password,
      });
      setSession(data);
      toast.success("Account created", {
        description: "Your paper portfolio is ready to trade.",
      });
      router.replace("/dashboard");
    } catch (error) {
      if (error?.code === "VALIDATION_ERROR" && Array.isArray(error.details)) {
        error.details.forEach((detail) => {
          const field = detail.path?.[0];
          if (["name", "email", "password"].includes(field)) {
            setError(field, { message: detail.message });
          }
        });
      }
      setError("root", {
        message: error?.message || "Unable to create your account.",
      });
    }
  };

  return (
    <div className="animate-rise">
      <div className="mb-7">
        <p className="eyebrow mb-2.5">Get started</p>
        <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.035em] text-fg">
          Create your account
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">
          Start with $10,000 in virtual capital and real market data.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {errors.root?.message ? (
          <Alert tone="danger" title="Could not create account">
            {errors.root.message}
          </Alert>
        ) : null}

        <Field label="Full name" htmlFor="name" error={errors.name?.message}>
          {({ id }) => (
            <Input
              id={id}
              autoComplete="name"
              placeholder="Asha Trader"
              leftIcon={<UserRound className="size-4" aria-hidden="true" />}
              invalid={Boolean(errors.name)}
              {...register("name")}
            />
          )}
        </Field>

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
              autoComplete="new-password"
              placeholder="Create a strong password"
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

        {password ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-[9px] border border-line bg-surface-2/60 px-3 py-2.5 sm:grid-cols-3">
            {rules.map((rule) => {
              const met = rule.test(password);
              return (
                <span
                  key={rule.key}
                  className={cn(
                    "flex items-center gap-1.5 text-[10.5px]",
                    met ? "text-up" : "text-fg-subtle",
                  )}
                >
                  {met ? (
                    <Check className="size-3" aria-hidden="true" />
                  ) : (
                    <X className="size-3" aria-hidden="true" />
                  )}
                  {rule.label}
                </span>
              );
            })}
          </div>
        ) : null}

        <Field
          label="Confirm password"
          htmlFor="confirmPassword"
          error={errors.confirmPassword?.message}
        >
          {({ id }) => (
            <Input
              id={id}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Repeat your password"
              leftIcon={<LockKeyhole className="size-4" aria-hidden="true" />}
              invalid={Boolean(errors.confirmPassword)}
              {...register("confirmPassword")}
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
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>

        <p className="text-center text-[10.5px] leading-relaxed text-fg-subtle">
          Stox is a simulator. All balances, orders and trades are virtual.
        </p>
      </form>

      <Divider label="or" className="my-5" />

      <GoogleSignInButton
        onSuccess={(data) => {
          setSession(data);
          toast.success("Account created with Google");
          router.replace("/dashboard");
        }}
        onError={(error) =>
          setError("root", {
            message: error?.message || "Google authentication failed.",
          })
        }
      />

      <p className="mt-7 text-center text-[12.5px] text-fg-muted">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-brand transition-colors hover:text-brand-strong"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
