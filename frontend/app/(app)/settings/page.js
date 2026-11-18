"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Check,
  LogOut,
  Monitor,
  Moon,
  Palette,
  ShieldCheck,
  Sun,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardHeading,
  CardTitle,
} from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authApi, preferencesApi } from "@/lib/endpoints";
import { useApi } from "@/lib/hooks";
import { formatDate } from "@/lib/format";
import { profileSchema } from "@/lib/validators";
import { useSession } from "@/store/use-session";
import { useUI } from "@/store/use-ui";
import { cn } from "@/lib/utils";

const themes = [
  {
    value: "dark",
    label: "Dark terminal",
    description: "Low-light, high-contrast. Built for long sessions.",
    icon: Moon,
  },
  {
    value: "light",
    label: "Light desk",
    description: "Bright surfaces for daylight and projection.",
    icon: Sun,
  },
];

function ProfileTab() {
  const user = useSession((state) => state.user);
  const setUser = useSession((state) => state.setUser);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: user?.name || "",
      avatarUrl: user?.avatarUrl || "",
    },
  });

  const name = watch("name");
  const avatarUrl = watch("avatarUrl");

  useEffect(() => {
    reset({
      name: user?.name || "",
      avatarUrl: user?.avatarUrl || "",
    });
  }, [user?.name, user?.avatarUrl, reset]);

  const onSubmit = async (values) => {
    try {
      const data = await authApi.updateProfile({
        name: values.name.trim(),
        avatarUrl: values.avatarUrl?.trim() || null,
      });
      const updated = data?.user ?? data;
      if (updated) setUser(updated);
      toast.success("Profile updated");
      reset({
        name: updated?.name || values.name,
        avatarUrl: updated?.avatarUrl || "",
      });
    } catch (error) {
      setError("root", {
        message: error?.message || "Could not update your profile.",
      });
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardHeading>
            <CardTitle>Public profile</CardTitle>
            <CardDescription>
              This is what other traders see next to your posts and on the
              leaderboard. Email is never public.
            </CardDescription>
          </CardHeading>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            {errors.root?.message ? (
              <div className="rounded-[8px] border border-down/25 bg-down-soft px-3 py-2 text-[12px] text-down">
                {errors.root.message}
              </div>
            ) : null}

            <Field label="Display name" htmlFor="profile-name" error={errors.name?.message}>
              {({ id }) => (
                <Input
                  id={id}
                  autoComplete="name"
                  invalid={Boolean(errors.name)}
                  {...register("name")}
                />
              )}
            </Field>

            <Field
              label="Avatar URL"
              htmlFor="profile-avatar"
              optional
              hint="A square image works best. Leave blank to use generated initials."
              error={errors.avatarUrl?.message}
            >
              {({ id }) => (
                <Input
                  id={id}
                  type="url"
                  placeholder="https://…"
                  invalid={Boolean(errors.avatarUrl)}
                  {...register("avatarUrl")}
                />
              )}
            </Field>

            <div className="flex items-center justify-between border-t border-line pt-4">
              <p className="text-[10.5px] text-fg-subtle">
                {isDirty ? "Unsaved changes" : "All changes saved"}
              </p>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={isSubmitting}
                disabled={!isDirty}
              >
                Save profile
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardHeading>
            <CardTitle>Preview</CardTitle>
            <CardDescription>How your identity appears</CardDescription>
          </CardHeading>
        </CardHeader>
        <CardContent>
          <div className="rounded-[12px] border border-line bg-surface-2/50 p-4 text-center">
            <Avatar
              src={avatarUrl || user?.avatarUrl}
              name={name || user?.name}
              size={64}
              className="mx-auto"
            />
            <p className="mt-3 text-[13px] font-semibold text-fg">
              {name || "Your name"}
            </p>
            <p className="mt-0.5 text-[10.5px] text-fg-subtle">
              Stox paper trader
            </p>
            <Badge tone="outline" className="mt-3">
              {user?.role || "TRADER"}
            </Badge>
          </div>
          <p className="mt-3 text-[10.5px] leading-relaxed text-fg-subtle">
            Your portfolio values and order history are never part of the public
            profile.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function PreferencesForm({ preferences, mutate }) {
  const [email, setEmail] = useState(preferences.emailNotifications ?? true);
  const [push, setPush] = useState(preferences.pushNotifications ?? false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    try {
      setSaving(true);
      await preferencesApi.update({
        emailNotifications: email,
        pushNotifications: push,
      });
      await mutate();
      toast.success("Notification preferences saved");
    } catch (error) {
      toast.error("Could not save preferences", { description: error?.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardHeading>
            <CardTitle>Notification channels</CardTitle>
            <CardDescription>
              In-app notifications are always delivered. Choose which outbound
              channels you also want.
            </CardDescription>
          </CardHeading>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4 rounded-[10px] border border-line bg-surface-2/40 p-4">
            <Switch
              label="Email notifications"
              description="Order outcomes, triggered alerts and important account events."
              checked={email}
              onCheckedChange={setEmail}
            />
            <div className="h-px bg-line" />
            <Switch
              label="Push notifications"
              description="Requires a registered push token. In-app delivery still applies."
              checked={push}
              onCheckedChange={setPush}
            />
          </div>

          <div className="flex items-center justify-between">
            <p className="text-[10.5px] text-fg-subtle">
              In-app notifications cannot be disabled.
            </p>
            <Button variant="primary" size="sm" loading={saving} onClick={save}>
              Save preferences
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardHeading>
            <CardTitle>What you receive</CardTitle>
          </CardHeading>
        </CardHeader>
        <CardContent className="space-y-2 text-[11.5px]">
          {[
            ["Order executed", "in-app + optional"],
            ["Order rejected", "in-app + optional"],
            ["Price alert", "in-app + email"],
            ["Copy trade", "in-app + optional"],
            ["Achievements", "in-app only"],
            ["Leagues", "in-app only"],
          ].map(([label, channel]) => (
            <div key={label} className="flex items-center justify-between gap-3">
              <span className="text-fg-muted">{label}</span>
              <span className="text-[10px] text-fg-subtle">{channel}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function PreferencesTab() {
  const { data, loading, mutate } = useApi("/preferences");
  const preferences = data?.preferences;

  if (loading && !preferences) {
    return <Skeleton className="h-[300px]" />;
  }

  return (
    <PreferencesForm
      key={preferences?.updatedAt || "defaults"}
      preferences={preferences || {}}
      mutate={mutate}
    />
  );
}

function AppearanceTab() {
  const theme = useUI((state) => state.theme);
  const setTheme = useUI((state) => state.setTheme);
  const sidebarCollapsed = useUI((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useUI((state) => state.setSidebarCollapsed);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardHeading>
            <CardTitle>Theme</CardTitle>
            <CardDescription>
              Both themes use the same semantic tokens. Charts, P&L and status
              colours stay consistent.
            </CardDescription>
          </CardHeading>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {themes.map((option) => {
            const active = theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setTheme(option.value)}
                aria-pressed={active}
                className={cn(
                  "relative overflow-hidden rounded-[12px] border p-3 text-left transition-[border-color,background-color] duration-200",
                  active
                    ? "border-brand/50 bg-brand-soft/30"
                    : "border-line bg-surface-2/40 hover:border-line-strong",
                )}
              >
                <div
                  className="mb-3 h-20 rounded-[8px] border border-line p-2"
                  style={{
                    background:
                      option.value === "dark" ? "#07090e" : "#f4f6fb",
                  }}
                >
                  <div className="flex gap-1">
                    <span
                      className="h-14 w-5 rounded-[3px]"
                      style={{
                        background:
                          option.value === "dark" ? "#0c1018" : "#ffffff",
                      }}
                    />
                    <span className="flex flex-1 flex-col gap-1">
                      <span
                        className="h-3 rounded-[2px]"
                        style={{
                          background:
                            option.value === "dark" ? "#111624" : "#eef2f8",
                        }}
                      />
                      <span className="flex flex-1 gap-1">
                        <span
                          className="flex-1 rounded-[2px]"
                          style={{
                            background:
                              option.value === "dark" ? "#111624" : "#eef2f8",
                          }}
                        />
                        <span
                          className="flex-1 rounded-[2px]"
                          style={{
                            background:
                              option.value === "dark"
                                ? "rgba(108,151,255,.25)"
                                : "rgba(49,92,255,.18)",
                          }}
                        />
                      </span>
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <option.icon
                    className={cn(
                      "size-4",
                      active ? "text-brand" : "text-fg-subtle",
                    )}
                    aria-hidden="true"
                  />
                  <span className="text-[12.5px] font-medium text-fg">
                    {option.label}
                  </span>
                  {active ? (
                    <Check className="ml-auto size-4 text-brand" aria-hidden="true" />
                  ) : null}
                </div>
                <p className="mt-1 text-[10.5px] leading-relaxed text-fg-subtle">
                  {option.description}
                </p>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardHeading>
            <CardTitle>Layout</CardTitle>
            <CardDescription>Density and navigation</CardDescription>
          </CardHeading>
        </CardHeader>
        <CardContent className="space-y-4">
          <Switch
            label="Collapse sidebar"
            description="Show icons only on large screens."
            checked={sidebarCollapsed}
            onCheckedChange={setSidebarCollapsed}
          />
          <div className="h-px bg-line" />
          <div className="flex items-center gap-2.5">
            <Monitor className="size-4 text-fg-subtle" aria-hidden="true" />
            <p className="text-[11px] text-fg-subtle">
              Layout adapts at 768px and 1024px. Tables become scrollable on
              small screens.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <Palette className="size-4 text-fg-subtle" aria-hidden="true" />
            <p className="text-[11px] text-fg-subtle">
              Motion respects your system reduced-motion preference.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AccountTab() {
  const user = useSession((state) => state.user);
  const signOut = useSession((state) => state.signOut);
  const router = useRouter();

  if (!user) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardHeading>
            <CardTitle>Account details</CardTitle>
            <CardDescription>
              Stox never handles deposits or withdrawals. Your account only
              holds virtual balances.
            </CardDescription>
          </CardHeading>
        </CardHeader>
        <CardContent className="space-y-2 text-[11.5px]">
          {[
            ["Email", user.email],
            ["Role", user.role],
            ["Verified", user.isVerified ? "Yes" : "No"],
            ["Suspended", user.isSuspended ? "Yes" : "No"],
            ["Member since", formatDate(user.createdAt)],
            ["Last login", user.lastLoginAt ? formatDate(user.lastLoginAt) : "—"],
          ].map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-0"
            >
              <span className="text-fg-subtle">{label}</span>
              <span className="truncate text-fg">{value}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 rounded-[8px] bg-up-soft px-3 py-2 text-[10.5px] text-up">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            All balances are simulated. No real money is at risk.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardHeading>
            <CardTitle>Session</CardTitle>
            <CardDescription>Sign out of this browser</CardDescription>
          </CardHeading>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 rounded-[9px] border border-line bg-surface-2/50 px-3 py-2.5">
            <Avatar src={user.avatarUrl} name={user.name} size={36} />
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium text-fg">
                {user.name}
              </p>
              <p className="truncate text-[10.5px] text-fg-subtle">
                {user.email}
              </p>
            </div>
          </div>
          <Button
            variant="danger-ghost"
            fullWidth
            onClick={async () => {
              await signOut();
              router.push("/login");
            }}
          >
            <LogOut className="size-4" aria-hidden="true" />
            Log out
          </Button>
          <p className="text-[10px] leading-relaxed text-fg-subtle">
            Logging out revokes the refresh token used by this browser.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Profile, notifications and appearance. Preferences are stored on your Stox account."
      />

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">
            <UserRound className="size-3.5" aria-hidden="true" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileTab />
        </TabsContent>
        <TabsContent value="notifications">
          <PreferencesTab />
        </TabsContent>
        <TabsContent value="appearance">
          <AppearanceTab />
        </TabsContent>
        <TabsContent value="account">
          <AccountTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
